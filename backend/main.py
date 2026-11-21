"""
RoadWatch — Road Accident and Dangerous Driving Detection System
FastAPI Backend — Phase 4A: Video Upload & Automated AI Processing
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone
import json
import statistics
import shutil
import uuid

from pipeline import (
    enqueue_job,
    load_job_meta,
    save_job_meta,
    list_all_jobs,
    get_job_dir,
    start_worker,
    request_job_cancellation,
)

app = FastAPI(
    title="RoadWatch API",
    description="Backend for the RoadWatch Traffic Intelligence System",
    version="4.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = Path(__file__).parent / "data" / "analysis.json"

# Start the background job worker on startup
@app.on_event("startup")
def on_startup():
    start_worker()


# ---------------------------------------------------------------------------
# Pydantic models — match the analysis schema
# ---------------------------------------------------------------------------

class Vehicle(BaseModel):
    id: int
    type: str
    first_seen: float
    last_seen: float
    frames_tracked: int
    average_motion_px_s: Optional[float]   # None for single-frame (unassessable) tracks
    abrupt_motion_changes: int
    risk_score: Optional[int]              # None for single-frame (unassessable) tracks
    risk_level: str                        # "Low", "Medium", "High", or "Unassessable"
    observation_quality: Optional[str] = "sufficient"  # "sufficient" | "insufficient"


class Event(BaseModel):
    vehicle_id: int
    timestamp: float
    type: str
    severity: str
    description: str


class AnalysisData(BaseModel):
    video: str
    duration_seconds: float
    frames_processed: int
    tracking_ids_observed: int
    vehicles_analyzed: int
    vehicles_assessable: Optional[int] = None   # tracks with >= 2 detections (motion computable)
    vehicles: list[Vehicle]
    events: list[Event]
    notes: Optional[list[str]] = []


# ---------------------------------------------------------------------------
# Data loader supporting both sample dataset and job sessions
# ---------------------------------------------------------------------------

def load_and_validate(job_id: Optional[str] = None) -> tuple[Optional[AnalysisData], Optional[str]]:
    """
    Load analysis.json for a specific job or the default sample analysis.
    Returns (data, None) on success or (None, error_message) on failure.
    """
    if job_id and job_id != "default":
        job_dir = get_job_dir(job_id)
        target_file = job_dir / "analysis.json"
        if not target_file.exists():
            meta = load_job_meta(job_id)
            if meta:
                status = meta.get("status", "unknown")
                if status == "processing":
                    return None, f"Analysis job {job_id} is currently processing ({meta.get('progress', 0)}%)."
                elif status == "queued":
                    return None, f"Analysis job {job_id} is currently queued."
                elif status == "cancelling":
                    return None, f"Analysis job {job_id} is being cancelled."
                elif status == "cancelled":
                    return None, f"Analysis job {job_id} was cancelled."
                elif status == "failed":
                    return None, f"Analysis job {job_id} failed: {meta.get('error', 'Unknown error')}."
            return None, f"Analysis results for job {job_id} not found."
    else:
        target_file = DATA_FILE
        if not target_file.exists():
            return None, "Default analysis.json not found."

    try:
        raw = target_file.read_text(encoding="utf-8")
    except OSError as exc:
        return None, f"Could not read analysis data: {exc}"

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"Analysis file contains invalid JSON: {exc}"

    try:
        data = AnalysisData(**parsed)
    except ValidationError as exc:
        return None, f"Analysis file has unexpected structure: {exc}"

    return data, None


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["System"])
def health():
    """System health check."""
    data, err = load_and_validate()
    return {
        "status": "ok",
        "data_available": err is None,
        "sample_data_file": str(DATA_FILE),
        "message": "Analysis data loaded and validated." if err is None else err,
    }


# ---------------------------------------------------------------------------
# Job Management Endpoints (Phase 4A)
# ---------------------------------------------------------------------------

@app.post("/api/jobs", tags=["Jobs"])
async def create_job(file: UploadFile = File(...)):
    """
    Upload a new traffic video and queue it for YOLO11n + ByteTrack analysis.
    """
    # 1. Validate file extension
    filename = file.filename or "video.mp4"
    if not filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 video files are accepted.")

    # 2. Generate unique job ID
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    rand_suffix = uuid.uuid4().hex[:6]
    job_id = f"job_{timestamp_str}_{rand_suffix}"

    job_dir = get_job_dir(job_id)
    input_path = job_dir / "input.mp4"

    # 3. Stream write file to disk with size validation (max 200 MB)
    MAX_SIZE = 200 * 1024 * 1024
    bytes_written = 0

    try:
        with open(input_path, "wb") as f_out:
            while chunk := await file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > MAX_SIZE:
                    input_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="File too large. Maximum size is 200 MB.")
                f_out.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        input_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save video: {exc}")

    # 4. Initialize metadata and queue job
    meta = {
        "job_id": job_id,
        "filename": filename,
        "filesize_bytes": bytes_written,
        "status": "queued",
        "progress": 0,
        "total_frames": 0,
        "processed_frames": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "error": None,
        "has_result": False,
        "has_video": False,
    }
    save_job_meta(job_id, meta)

    # 5. Enqueue in background worker
    enqueue_job(job_id)

    return {
        "status": "ok",
        "job_id": job_id,
        "filename": filename,
        "filesize_bytes": bytes_written,
        "message": "Video uploaded and queued for processing.",
    }


@app.get("/api/jobs", tags=["Jobs"])
def list_jobs():
    """List all previous analysis jobs, newest first."""
    jobs = list_all_jobs()
    return {"status": "ok", "count": len(jobs), "jobs": jobs}


@app.get("/api/jobs/{job_id}", tags=["Jobs"])
def get_job(job_id: str):
    """Get the current status, progress and details of an analysis job."""
    meta = load_job_meta(job_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    return {"status": "ok", "job": meta}


@app.post("/api/jobs/{job_id}/cancel", tags=["Jobs"])
def cancel_job(job_id: str):
    """
    Cancel an in-progress or queued video analysis job.
    Clean up partial artifacts and halt background processing safely.
    """
    meta = load_job_meta(job_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    status = meta.get("status")
    if status in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{status}'.",
        )

    if status == "cancelled":
        return {
            "status": "ok",
            "message": "Job is already cancelled.",
            "job": meta,
        }

    res = request_job_cancellation(job_id)
    if not res.get("success"):
        raise HTTPException(
            status_code=400,
            detail=res.get("error", "Failed to cancel job."),
        )

    updated_meta = load_job_meta(job_id) or meta
    return {
        "status": "ok",
        "message": "Cancellation requested successfully.",
        "job": updated_meta,
    }


@app.get("/api/jobs/{job_id}/analysis", tags=["Jobs"])
def get_job_analysis(job_id: str):
    """Get the completed analysis JSON for a specific job."""
    data, err = load_and_validate(job_id=job_id)
    if err:
        return {"status": "pending", "message": err, "data": None}
    return {"status": "ok", "data": data.model_dump()}


@app.api_route("/api/jobs/{job_id}/video", methods=["GET", "HEAD"], tags=["Jobs"])
def get_job_video(job_id: str):
    """Serve the annotated MP4 video for a completed job, supporting GET, HEAD and Range requests."""
    job_dir = get_job_dir(job_id)
    video_path = job_dir / "annotated.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Annotated video not found or still processing.")
    return FileResponse(str(video_path), media_type="video/mp4")


# ---------------------------------------------------------------------------
# Analytics Endpoints (Supports both default sample and job_id)
# ---------------------------------------------------------------------------

@app.get("/api/analysis", tags=["Analysis"])
def get_analysis(job_id: Optional[str] = Query(None, description="Optional job ID")):
    """Return the full analysis data for the specified job or default sample."""
    data, err = load_and_validate(job_id=job_id)
    if err:
        return {"status": "missing", "message": err, "data": None}
    return {"status": "ok", "job_id": job_id or "default", "data": data.model_dump()}


@app.get("/api/summary", tags=["Analysis"])
def get_summary(job_id: Optional[str] = Query(None, description="Optional job ID")):
    """Derive summary statistics dynamically from the specified job or default sample."""
    data, err = load_and_validate(job_id=job_id)
    if err:
        return {"status": "missing", "message": err, "summary": None}

    vehicles = data.vehicles
    events = data.events

    # Separate assessable (>= 2 frames, valid motion + risk) from unassessable (1 frame)
    assessable = [v for v in vehicles if v.observation_quality == "sufficient" and v.risk_score is not None]
    unassessable_count = len(vehicles) - len(assessable)

    scores = [v.risk_score for v in assessable]
    high_risk = sum(1 for v in assessable if v.risk_level == "High")
    medium_risk = sum(1 for v in assessable if v.risk_level == "Medium")
    low_risk = sum(1 for v in assessable if v.risk_level == "Low")

    motions = [v.average_motion_px_s for v in assessable if v.average_motion_px_s is not None]

    type_counts: dict[str, int] = {}
    for v in vehicles:
        type_counts[v.type] = type_counts.get(v.type, 0) + 1

    sev_counts: dict[str, int] = {}
    for e in events:
        sev_counts[e.severity] = sev_counts.get(e.severity, 0) + 1

    summary = {
        "job_id": job_id or "default",
        "video": data.video,
        "duration_seconds": data.duration_seconds,
        "frames_processed": data.frames_processed,
        "tracking_ids_observed": data.tracking_ids_observed,
        "vehicles_analyzed": data.vehicles_analyzed,
        "vehicles_assessable": data.vehicles_assessable if data.vehicles_assessable is not None else len(assessable),
        "vehicles_unassessable": unassessable_count,
        "total_events": len(events),
        "max_risk_score": max(scores) if scores else None,
        "average_risk_score": round(statistics.mean(scores), 2) if scores else None,
        "risk_distribution": {
            "high": high_risk,
            "medium": medium_risk,
            "low": low_risk,
            "unassessable": unassessable_count,
        },
        "motion_stats_px_s": {
            "max": round(max(motions), 2) if motions else None,
            "min": round(min(motions), 2) if motions else None,
            "mean": round(statistics.mean(motions), 2) if motions else None,
            "median": round(statistics.median(motions), 2) if motions else None,
        },
        "vehicle_type_counts": type_counts,
        "event_severity_counts": sev_counts,
        "notes": data.notes,
    }

    return {"status": "ok", "summary": summary}


@app.get("/api/vehicles", tags=["Vehicles"])
def get_vehicles(
    job_id: Optional[str] = Query(None, description="Optional job ID"),
    sort_by: str = "risk_score",
    order: str = "desc",
    vehicle_type: Optional[str] = None,
    min_risk: Optional[int] = None,
):
    """Return tracked vehicle list from the specified job or default sample."""
    data, err = load_and_validate(job_id=job_id)
    if err:
        return {"status": "missing", "message": err, "vehicles": [], "count": 0}

    vehicles = data.vehicles

    if vehicle_type:
        vehicles = [v for v in vehicles if v.type.lower() == vehicle_type.lower()]
    if min_risk is not None:
        vehicles = [v for v in vehicles if v.risk_score is not None and v.risk_score >= min_risk]

    allowed_sort_fields = {
        "risk_score", "average_motion_px_s", "frames_tracked",
        "first_seen", "last_seen", "abrupt_motion_changes", "id",
    }
    if sort_by not in allowed_sort_fields:
        sort_by = "risk_score"

    is_reverse = (order.lower() != "asc")
    def _sort_key(v):
        val = getattr(v, sort_by, None)
        if val is None:
            # Send None/unassessable to the end of the list in either sort direction
            return -float("inf") if is_reverse else float("inf")
        return val

    vehicles = sorted(
        vehicles,
        key=_sort_key,
        reverse=is_reverse,
    )

    return {
        "status": "ok",
        "job_id": job_id or "default",
        "count": len(vehicles),
        "vehicles": [v.model_dump() for v in vehicles],
    }


@app.get("/api/events", tags=["Events"])
def get_events(
    job_id: Optional[str] = Query(None, description="Optional job ID"),
    severity: Optional[str] = None,
):
    """Return detected motion anomaly events from the specified job or default sample."""
    data, err = load_and_validate(job_id=job_id)
    if err:
        return {"status": "missing", "message": err, "events": [], "count": 0}

    events = data.events

    if severity:
        events = [e for e in events if e.severity.lower() == severity.lower()]

    events = sorted(events, key=lambda e: e.timestamp)

    return {
        "status": "ok",
        "job_id": job_id or "default",
        "count": len(events),
        "events": [e.model_dump() for e in events],
    }
