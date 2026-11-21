"""
RoadWatch — Automated Video Analysis Pipeline
Optimized YOLO11n + ByteTrack Vehicle Detection & Motion Tracking
With Real-Time Thread-Safe Job Cancellation Support
"""

from pathlib import Path
import json
import time
import math
import subprocess
import threading
import queue
from datetime import datetime, timezone
import numpy as np
import cv2
import imageio_ffmpeg
import torch
from ultralytics import YOLO

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
JOBS_DIR = DATA_DIR / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# COCO vehicle classes: 2=car, 3=motorcycle, 5=bus, 7=truck
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# Color palette for bounding boxes (BGR)
BOX_COLORS = {
    "car": (240, 240, 240),         # white / light gray
    "bus": (200, 150, 50),          # muted cyan/blue
    "truck": (50, 180, 240),        # amber / orange
    "motorcycle": (180, 100, 240),  # purple/magenta
}

# Target parameters for optimized processing
MAX_WIDTH = 1280          # Increased from 640: needed for aerial/4K video detection
INFERENCE_IMGSZ = 1280    # Increased from 416: needed to resolve small objects at distance
TARGET_PROCESSING_FPS = 30.0  # 30 fps maintains sub-70ms frame intervals for highway vehicle tracking
DETECTION_CONF = 0.05     # Calibrated to 0.05 to feed ByteTrack's two-stage matching (track_low_thresh=0.05)
DETECTION_IOU = 0.45      # Slightly lower than default 0.5 for better overlap handling

# Global model cache to avoid repeatedly loading weights from disk
_shared_model = None
_model_lock = threading.Lock()

# Single-worker queue for local processing
job_queue = queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()

# Thread-safe cancellation tracking
_cancellation_events: dict[str, threading.Event] = {}
_cancellation_lock = threading.Lock()


def detect_device() -> str:
    """Detect whether CUDA GPU acceleration is available."""
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_shared_model(device: str) -> YOLO:
    """
    Retrieve or initialize the shared YOLO11n model.
    Avoids reloading model weights from disk on every job or frame.
    """
    global _shared_model
    with _model_lock:
        if _shared_model is None:
            model_path = BASE_DIR / "yolo11n.pt"
            if not model_path.exists():
                raise FileNotFoundError(f"Model file not found: {model_path}")
            _shared_model = YOLO(str(model_path))
        return _shared_model


def get_job_dir(job_id: str) -> Path:
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def load_job_meta(job_id: str) -> dict | None:
    job_file = get_job_dir(job_id) / "job.json"
    if not job_file.exists():
        return None
    try:
        return json.loads(job_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_job_meta(job_id: str, meta: dict):
    job_file = get_job_dir(job_id) / "job.json"
    meta["updated_at"] = datetime.now(timezone.utc).isoformat()
    job_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def list_all_jobs() -> list[dict]:
    jobs = []
    if not JOBS_DIR.exists():
        return []
    for d in JOBS_DIR.iterdir():
        if d.is_dir():
            meta = load_job_meta(d.name)
            if meta:
                jobs.append(meta)
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs


def is_job_cancelled(job_id: str) -> bool:
    """Check if cancellation was signaled for this job."""
    with _cancellation_lock:
        evt = _cancellation_events.get(job_id)
        if evt and evt.is_set():
            return True
    meta = load_job_meta(job_id)
    if meta and meta.get("status") in ("cancelling", "cancelled"):
        return True
    return False


def request_job_cancellation(job_id: str) -> dict:
    """
    Signal cancellation for a queued or running job.
    Thread-safe and updates job state immediately.
    """
    with _cancellation_lock:
        if job_id not in _cancellation_events:
            _cancellation_events[job_id] = threading.Event()
        _cancellation_events[job_id].set()

    meta = load_job_meta(job_id)
    if not meta:
        return {"success": False, "error": f"Job {job_id} not found."}

    current_status = meta.get("status")
    if current_status in ("completed", "failed"):
        return {"success": False, "error": f"Job {job_id} is already {current_status} and cannot be cancelled."}

    if current_status == "queued":
        meta["status"] = "cancelled"
        meta["error"] = "Cancelled by user while in queue."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return {"success": True, "job": meta}

    # If currently processing
    meta["status"] = "cancelling"
    save_job_meta(job_id, meta)
    return {"success": True, "job": meta}


def cleanup_cancellation(job_id: str):
    """Remove cancellation event once job has reached terminal state."""
    with _cancellation_lock:
        _cancellation_events.pop(job_id, None)


def run_pipeline_for_job(job_id: str):
    """
    Execute optimized YOLO11n + ByteTrack analysis on the job's input video.
    Frequently checks for cancellation and safely cleans up partial files.
    """
    job_dir = get_job_dir(job_id)
    meta = load_job_meta(job_id) or {}

    raw_annotated_path = job_dir / "raw_annotated.mp4"
    final_video_path = job_dir / "annotated.mp4"
    analysis_file = job_dir / "analysis.json"

    cap = None
    out = None

    def clean_partial_artifacts():
        nonlocal cap, out
        if cap is not None and cap.isOpened():
            cap.release()
        if out is not None and out.isOpened():
            out.release()
        for p in (raw_annotated_path, final_video_path, analysis_file):
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass

    # Pre-check if job was already cancelled
    if is_job_cancelled(job_id):
        clean_partial_artifacts()
        meta["status"] = "cancelled"
        meta["error"] = "Analysis cancelled by user."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    meta["status"] = "processing"
    meta["progress"] = 0
    save_job_meta(job_id, meta)

    input_video = job_dir / "input.mp4"
    if not input_video.exists():
        meta["status"] = "failed"
        meta["error"] = "Input video file not found."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    cap = cv2.VideoCapture(str(input_video))
    if not cap.isOpened():
        meta["status"] = "failed"
        meta["error"] = "Could not open video file with OpenCV."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    orig_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    orig_total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    orig_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if orig_total_frames <= 0 or orig_width <= 0 or orig_height <= 0:
        meta["status"] = "failed"
        meta["error"] = "Invalid video dimensions or frame count."
        clean_partial_artifacts()
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    duration = round(orig_total_frames / orig_fps, 2)

    # 1. Target frame rate reduction (~15 FPS)
    if orig_fps > 18.0:
        step = max(1, round(orig_fps / TARGET_PROCESSING_FPS))
        proc_fps = round(orig_fps / step, 3)
    else:
        step = 1
        proc_fps = round(orig_fps, 3)

    total_frames_to_process = max(1, math.ceil(orig_total_frames / step))

    # 2. Target dimension reduction (max width MAX_WIDTH while preserving aspect ratio)
    if orig_width > MAX_WIDTH:
        scale = MAX_WIDTH / float(orig_width)
        target_width = MAX_WIDTH
        target_height = int(round(orig_height * scale))
    else:
        target_width = orig_width
        target_height = orig_height

    # Enforce even dimensions required by video codecs (H.264 / mp4v)
    if target_width % 2 != 0:
        target_width -= 1
    if target_height % 2 != 0:
        target_height -= 1

    device = detect_device()

    # Update metadata to reflect actual processing parameters
    meta["total_frames"] = total_frames_to_process
    meta["original_frames"] = orig_total_frames
    meta["processed_frames"] = 0
    meta["fps"] = proc_fps
    meta["original_fps"] = round(orig_fps, 2)
    meta["duration_seconds"] = duration
    meta["resolution"] = f"{target_width}x{target_height}"
    meta["device"] = device
    save_job_meta(job_id, meta)

    # Temporary output for OpenCV VideoWriter
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(raw_annotated_path), fourcc, proc_fps, (target_width, target_height))

    # Check cancellation before loading model
    if is_job_cancelled(job_id):
        clean_partial_artifacts()
        meta["status"] = "cancelled"
        meta["error"] = "Analysis cancelled by user."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    # Retrieve cached model and reset tracker state for clean separation across jobs
    model = get_shared_model(device)
    if hasattr(model, "predictor") and model.predictor and hasattr(model.predictor, "trackers"):
        model.predictor.trackers = []

    # Tracking storage
    tracks = {}  # track_id -> dict
    all_observed_ids = set()

    raw_frame_idx = 0
    processed_frame_idx = 0
    last_update_time = time.time()
    needs_resize = (orig_width, orig_height) != (target_width, target_height)

    while True:
        # Check cancellation at every frame
        if is_job_cancelled(job_id):
            clean_partial_artifacts()
            meta["status"] = "cancelled"
            meta["error"] = "Analysis cancelled by user."
            save_job_meta(job_id, meta)
            cleanup_cancellation(job_id)
            return

        # Fast frame grab
        if not cap.grab():
            break

        # Frame rate downsampling: only retrieve and decode sampled frames
        if raw_frame_idx % step != 0:
            raw_frame_idx += 1
            continue

        ret, frame = cap.retrieve()
        if not ret:
            break

        # Calculate exact real-world timestamp for this frame
        timestamp = round(raw_frame_idx / orig_fps, 3)

        # Resize frame to max width 640
        if needs_resize:
            frame = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)

        # Track with ByteTrack using traffic-tuned settings
        results = model.track(
            frame,
            persist=True,
            tracker=str(BASE_DIR / "bytetrack_traffic.yaml"),
            classes=list(VEHICLE_CLASSES.keys()),
            verbose=False,
            conf=DETECTION_CONF,
            iou=DETECTION_IOU,
            imgsz=INFERENCE_IMGSZ,
            device=device,
        )

        annotated_frame = frame  # Draw in-place on the resized frame

        if results and len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            for box in boxes:
                if box.id is None:
                    continue
                track_id = int(box.id[0].item())
                cls_id = int(box.cls[0].item())
                type_name = VEHICLE_CLASSES.get(cls_id, "car")
                all_observed_ids.add(track_id)

                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0

                if track_id not in tracks:
                    tracks[track_id] = {
                        "id": track_id,
                        "type": type_name,
                        "positions": [],
                        "frames_tracked": 0,
                        "first_seen": timestamp,
                        "last_seen": timestamp,
                    }

                tracks[track_id]["positions"].append((processed_frame_idx, timestamp, cx, cy))
                tracks[track_id]["frames_tracked"] += 1
                tracks[track_id]["last_seen"] = timestamp

                # Draw bounding box and label
                color = BOX_COLORS.get(type_name, (200, 200, 200))
                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)

                label = f"ID:{track_id} {type_name}"
                font = cv2.FONT_HERSHEY_SIMPLEX
                font_scale = 0.5
                thickness = 1
                (lbl_w, lbl_h), _ = cv2.getTextSize(label, font, font_scale, thickness)

                # Label background
                cv2.rectangle(
                    annotated_frame,
                    (x1, max(0, y1 - lbl_h - 6)),
                    (x1 + lbl_w + 6, max(lbl_h + 6, y1)),
                    (20, 20, 20),
                    -1,
                )
                cv2.putText(
                    annotated_frame,
                    label,
                    (x1 + 3, max(lbl_h + 2, y1 - 3)),
                    font,
                    font_scale,
                    color,
                    thickness,
                    cv2.LINE_AA,
                )

        out.write(annotated_frame)
        processed_frame_idx += 1
        raw_frame_idx += 1

        # Periodically save progress to reflect actual frames processed
        if time.time() - last_update_time > 0.4 or processed_frame_idx == total_frames_to_process:
            meta["processed_frames"] = processed_frame_idx
            meta["progress"] = min(90, int((processed_frame_idx / total_frames_to_process) * 85))
            save_job_meta(job_id, meta)
            last_update_time = time.time()

    cap.release()
    out.release()
    cap = None
    out = None

    # Check cancellation after video processing loop
    if is_job_cancelled(job_id):
        clean_partial_artifacts()
        meta["status"] = "cancelled"
        meta["error"] = "Analysis cancelled by user."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    meta["progress"] = 90
    meta["processed_frames"] = processed_frame_idx
    save_job_meta(job_id, meta)

    # ── Post-processing Analytics ──
    # MIN_FRAMES: minimum consecutive detections required to include a track.
    # Lowered from 6/8 for step>1/step=1 because aerial footage at distance
    # produces valid but brief tracks (vehicles exit frame in 1–4 sampled frames).
    # Minimum 1 frame needed; 2+ frames needed for velocity calculation.
    MIN_FRAMES = 1 if step > 1 else 2
    # MIN_FRAMES_FOR_MOTION: tracks need >= 2 position samples to compute velocity
    MIN_FRAMES_FOR_MOTION = 2
    analyzed_tracks = [t for t in tracks.values() if t["frames_tracked"] >= MIN_FRAMES]

    analyzed_vehicles = []
    events = []

    for t in analyzed_tracks:
        positions = t["positions"]
        has_sufficient_obs = t["frames_tracked"] >= MIN_FRAMES_FOR_MOTION

        velocities = []
        if has_sufficient_obs:
            for i in range(1, len(positions)):
                dt = positions[i][1] - positions[i - 1][1]
                if dt <= 0:
                    continue
                dx = positions[i][2] - positions[i - 1][2]
                dy = positions[i][3] - positions[i - 1][3]
                dist = (dx**2 + dy**2) ** 0.5
                v = dist / dt  # px/s
                velocities.append(v)

        # For single-frame tracks: motion and risk are genuinely unknown — store None
        # so the frontend can distinguish "measured zero" from "not measurable".
        avg_motion = round(float(np.mean(velocities)), 2) if velocities else (None if not has_sufficient_obs else 0.0)

        # Abrupt motion changes: sudden speed shifts (> 75 px/s delta)
        abrupt_changes = 0
        if velocities:
            for i in range(1, len(velocities)):
                dv = abs(velocities[i] - velocities[i - 1])
                if dv > 75.0:
                    abrupt_changes += 1

        if not has_sufficient_obs:
            # Cannot compute a valid risk score from a single detection.
            # Mark explicitly as unassessable so the UI does not show misleading numbers.
            risk_score = None
            risk_level = "Unassessable"
        else:
            # Heuristic risk calculation (reproducing Colab model) — unchanged
            type_weight = 0
            if abrupt_changes > 0:
                if t["type"] == "truck":
                    type_weight = 10
                elif t["type"] == "bus":
                    type_weight = 8
                elif t["type"] == "motorcycle":
                    type_weight = 5

            base_motion_risk = round((avg_motion or 0) / 8.0)
            raw_risk = base_motion_risk + (abrupt_changes * 10) + type_weight
            risk_score = min(100, max(0, raw_risk))

            if risk_score >= 65:
                risk_level = "High"
            elif risk_score >= 35:
                risk_level = "Medium"
            else:
                risk_level = "Low"

        v_data = {
            "id": t["id"],
            "type": t["type"],
            "first_seen": t["first_seen"],
            "last_seen": t["last_seen"],
            "frames_tracked": t["frames_tracked"],
            "average_motion_px_s": avg_motion,
            "abrupt_motion_changes": abrupt_changes,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "observation_quality": "sufficient" if has_sufficient_obs else "insufficient",
        }
        analyzed_vehicles.append(v_data)

        # Events: repeated abrupt changes (>= 2) — only for assessable tracks
        if has_sufficient_obs and abrupt_changes >= 2:
            events.append(
                {
                    "vehicle_id": t["id"],
                    "timestamp": t["last_seen"],
                    "type": "Abrupt motion",
                    "severity": risk_level,
                    "description": "Repeated abrupt changes in observed image motion",
                }
            )

    # Sort vehicles: assessable first (by risk_score desc), then unassessable (by id)
    analyzed_vehicles.sort(
        key=lambda v: (0 if v["risk_score"] is not None else 1, -(v["risk_score"] or 0))
    )
    events.sort(key=lambda e: e["timestamp"])

    vehicles_assessable = sum(1 for v in analyzed_vehicles if v["observation_quality"] == "sufficient")

    analysis_json_data = {
        "video": meta.get("filename", "uploaded_video.mp4"),
        "duration_seconds": duration,
        "frames_processed": processed_frame_idx,
        "tracking_ids_observed": len(all_observed_ids),
        "vehicles_analyzed": len(analyzed_vehicles),
        "vehicles_assessable": vehicles_assessable,
        "vehicles": analyzed_vehicles,
        "events": events,
        "notes": [
            "Motion values are in image pixels per second, not km/h.",
            "Risk scores are heuristic relative indicators, not probabilities.",
            "Abrupt motion does not confirm dangerous driving or accidents.",
            "Proximity and collision detection are not implemented in this version.",
            "Tracks with observation_quality='insufficient' had only 1 detection frame; motion and risk could not be measured.",
        ],
    }

    # Check cancellation before writing analysis file
    if is_job_cancelled(job_id):
        clean_partial_artifacts()
        meta["status"] = "cancelled"
        meta["error"] = "Analysis cancelled by user."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    # Save analysis.json for this job
    analysis_file.write_text(json.dumps(analysis_json_data, indent=2), encoding="utf-8")

    # Check cancellation before transcoding
    if is_job_cancelled(job_id):
        clean_partial_artifacts()
        meta["status"] = "cancelled"
        meta["error"] = "Analysis cancelled by user."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    # Transcode video to web-compatible faststart H.264 using imageio_ffmpeg with veryfast preset
    try:
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [
            ffmpeg_exe,
            "-y",
            "-i",
            str(raw_annotated_path),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-movflags",
            "+faststart",
            str(final_video_path),
        ]
        ffmpeg_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        while ffmpeg_proc.poll() is None:
            if is_job_cancelled(job_id):
                ffmpeg_proc.terminate()
                try:
                    ffmpeg_proc.wait(timeout=2)
                except Exception:
                    ffmpeg_proc.kill()
                clean_partial_artifacts()
                meta["status"] = "cancelled"
                meta["error"] = "Analysis cancelled by user during video generation."
                save_job_meta(job_id, meta)
                cleanup_cancellation(job_id)
                return
            time.sleep(0.1)

        if ffmpeg_proc.returncode != 0:
            raise subprocess.CalledProcessError(ffmpeg_proc.returncode, cmd)

        if raw_annotated_path.exists():
            raw_annotated_path.unlink()
    except Exception as exc:
        print(f"Warning: FFmpeg transcoding fallback: {exc}")
        if is_job_cancelled(job_id):
            clean_partial_artifacts()
            meta["status"] = "cancelled"
            meta["error"] = "Analysis cancelled by user."
            save_job_meta(job_id, meta)
            cleanup_cancellation(job_id)
            return
        if not final_video_path.exists() and raw_annotated_path.exists():
            raw_annotated_path.rename(final_video_path)

    # Final cancellation check before completion
    if is_job_cancelled(job_id):
        clean_partial_artifacts()
        meta["status"] = "cancelled"
        meta["error"] = "Analysis cancelled by user."
        save_job_meta(job_id, meta)
        cleanup_cancellation(job_id)
        return

    meta["status"] = "completed"
    meta["progress"] = 100
    meta["processed_frames"] = processed_frame_idx
    meta["has_result"] = True
    meta["has_video"] = final_video_path.exists()
    meta["completed_at"] = datetime.now(timezone.utc).isoformat()
    save_job_meta(job_id, meta)
    cleanup_cancellation(job_id)


def _worker_loop():
    while True:
        job_id = job_queue.get()
        try:
            if is_job_cancelled(job_id):
                meta = load_job_meta(job_id) or {}
                meta["status"] = "cancelled"
                if not meta.get("error"):
                    meta["error"] = "Cancelled by user while in queue."
                save_job_meta(job_id, meta)
                cleanup_cancellation(job_id)
            else:
                run_pipeline_for_job(job_id)
        except Exception as e:
            meta = load_job_meta(job_id) or {}
            meta["status"] = "failed"
            meta["error"] = f"Pipeline execution error: {str(e)}"
            save_job_meta(job_id, meta)
            cleanup_cancellation(job_id)
        finally:
            job_queue.task_done()


def start_worker():
    global _worker_started
    with _worker_lock:
        if not _worker_started:
            t = threading.Thread(target=_worker_loop, daemon=True)
            t.start()
            _worker_started = True


def enqueue_job(job_id: str):
    start_worker()
    job_queue.put(job_id)
