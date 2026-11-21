import cv2
from ultralytics import YOLO
import time
from pathlib import Path

video_path = r"C:\Users\lenovo\Downloads\14333302_3840_2160_60fps.mp4"
model_path = r"C:\Users\lenovo\Downloads\image and vdo project\roadwatch\backend\yolo11n.pt"
tracker_yaml = r"C:\Users\lenovo\Downloads\image and vdo project\roadwatch\backend\bytetrack_traffic.yaml"

# Let's ensure bytetrack_traffic.yaml has optimal thresholds
Path(tracker_yaml).write_text("""tracker_type: bytetrack
track_high_thresh: 0.18
track_low_thresh: 0.05
new_track_thresh: 0.18
track_buffer: 60
match_thresh: 0.85
fuse_score: True
""")

model = YOLO(model_path)

def test_pipeline_tracking(conf_prefilter, imgsz, step=2):
    t0 = time.time()
    cap = cv2.VideoCapture(video_path)
    total_raw_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)

    if hasattr(model, "predictor") and model.predictor and hasattr(model.predictor, "trackers"):
        model.predictor.trackers = []

    frame_idx = 0
    proc_idx = 0
    track_history = {} # tid -> list of (proc_idx, cx, cy)
    det_per_frame = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step != 0:
            frame_idx += 1
            continue

        h, w = frame.shape[:2]
        target_w = imgsz
        target_h = int(round((target_w / w) * h))
        if target_h % 2 != 0:
            target_h += 1
        resized = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)

        results = model.track(
            resized,
            persist=True,
            tracker=tracker_yaml,
            classes=[2, 3, 5, 7],
            verbose=False,
            conf=conf_prefilter, # Let ByteTrack filter via its high/low thresholds!
            imgsz=imgsz,
            device="cpu"
        )

        raw_det = 0
        if results and len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            raw_det = len(boxes)
            for b in boxes:
                if b.id is not None:
                    tid = int(b.id[0].item())
                    x1, y1, x2, y2 = b.xyxy[0].tolist()
                    cx = (x1 + x2) / 2.0
                    cy = (y1 + y2) / 2.0
                    if tid not in track_history:
                        track_history[tid] = []
                    track_history[tid].append((proc_idx, cx, cy))

        det_per_frame.append(raw_det)
        proc_idx += 1
        frame_idx += 1

    cap.release()
    elapsed = time.time() - t0

    durations = [len(pts) for pts in track_history.values()]
    dur_1 = sum(1 for d in durations if d == 1)
    dur_2_4 = sum(1 for d in durations if 2 <= d <= 4)
    dur_5plus = sum(1 for d in durations if d >= 5)
    dur_10plus = sum(1 for d in durations if d >= 10)
    dur_20plus = sum(1 for d in durations if d >= 20)
    assessable = sum(1 for d in durations if d >= 2)

    print(f"\n=======================================================")
    print(f"BENCHMARK: imgsz={imgsz}, conf_prefilter={conf_prefilter}, step={step}")
    print(f"  Processed {proc_idx}/{total_raw_frames} frames in {elapsed:.2f}s ({elapsed/proc_idx*1000:.1f} ms/frame)")
    print(f"  Avg raw detections per frame: {sum(det_per_frame)/len(det_per_frame):.2f}")
    print(f"  Total unique tracks: {len(track_history)}")
    print(f"  1-frame tracks: {dur_1}")
    print(f"  2-4 frame tracks: {dur_2_4}")
    print(f"  5+ frame tracks: {dur_5plus}")
    print(f"  10+ frame tracks: {dur_10plus}")
    print(f"  20+ frame tracks: {dur_20plus}")
    print(f"  Assessable (>= 2 frames): {assessable}")
    if durations:
        print(f"  Max track duration: {max(durations)} frames, Avg track duration: {sum(durations)/len(durations):.1f} frames")
    print(f"  Top tracks by length:")
    for tid, pts in sorted(track_history.items(), key=lambda x: len(x[1]), reverse=True)[:8]:
        span_s = (pts[-1][0] - pts[0][0]) / (fps / step)
        print(f"    Track V-{tid}: {len(pts)} frames, span {pts[0][0]} -> {pts[-1][0]} ({span_s:.2f}s)")

print("Running ByteTrack two-stage prefilter comparison...")
# Compare conf_prefilter=0.15 (old) vs conf_prefilter=0.05 (let ByteTrack use stage 2!)
test_pipeline_tracking(conf_prefilter=0.15, imgsz=1280, step=2)
test_pipeline_tracking(conf_prefilter=0.05, imgsz=1280, step=2)
