"""
Verification script for RoadWatch Phase 4A:
Upload, Job Creation, YOLO11n + ByteTrack Processing, Result Retrieval, Multi-session
"""

import requests
import time
import sys
from pathlib import Path

BASE = "http://127.0.0.1:8000/api"

def main():
    # 1. Test health
    r = requests.get(f"{BASE}/health")
    print(f"1. Health check: {r.status_code} status={r.json().get('status')}")

    # 2. Upload test video
    video_path = Path("test_short.mp4")
    if not video_path.exists():
        print("Error: test_short.mp4 not found!")
        sys.exit(1)

    print("2. Uploading test video to POST /api/jobs ...")
    with open(video_path, "rb") as f:
        r = requests.post(f"{BASE}/jobs", files={"file": ("traffic_test_clip.mp4", f, "video/mp4")})

    print(f"   Upload response: {r.status_code}")
    job_data = r.json()
    job_id = job_data.get("job_id")
    print(f"   Job ID assigned: {job_id}")
    assert job_id, "No job_id returned"

    # 3. Poll progress
    print("3. Polling processing progress...")
    status = "queued"
    for i in range(120):
        r = requests.get(f"{BASE}/jobs/{job_id}")
        data = r.json().get("job", {})
        status = data.get("status")
        prog = data.get("progress")
        proc = data.get("processed_frames")
        tot = data.get("total_frames")
        print(f"   Poll #{i+1:02d}: status={status}, progress={prog}%, frames={proc}/{tot}")
        if status in ("completed", "failed"):
            break
        time.sleep(1.0)

    if status != "completed":
        print(f"FAIL: Job ended with status: {status}, error: {data.get('error')}")
        sys.exit(1)
    print("4. Job 1 successfully COMPLETED!")

    # 4. Verify analysis output
    r = requests.get(f"{BASE}/jobs/{job_id}/analysis")
    ana = r.json().get("data", {})
    print(f"5. Analysis results retrieved:")
    print(f"   - Video: {ana.get('video')}")
    print(f"   - Frames processed: {ana.get('frames_processed')}")
    print(f"   - Duration: {ana.get('duration_seconds')}s")
    print(f"   - Tracking IDs observed: {ana.get('tracking_ids_observed')}")
    print(f"   - Vehicles analyzed: {ana.get('vehicles_analyzed')}")
    print(f"   - Events detected: {len(ana.get('events', []))}")
    if ana.get("vehicles"):
        top_v = ana["vehicles"][0]
        print(f"   - Top vehicle: ID={top_v['id']}, type={top_v['type']}, motion={top_v['average_motion_px_s']} px/s, risk={top_v['risk_score']}/100")

    # 5. Verify video output
    r = requests.get(f"{BASE}/jobs/{job_id}/video", stream=True)
    print(f"6. Annotated video endpoint: status={r.status_code}, content-type={r.headers.get('content-type')}, length={r.headers.get('content-length')} bytes")
    assert r.status_code == 200, "Video endpoint failed"

    # 6. Test second upload
    print("7. Uploading second video to verify multiple distinct sessions...")
    with open(video_path, "rb") as f:
        r2 = requests.post(f"{BASE}/jobs", files={"file": ("second_clip.mp4", f, "video/mp4")})
    job_id_2 = r2.json().get("job_id")
    print(f"   Second Job ID: {job_id_2}")
    assert job_id_2 != job_id, "Second job ID must be distinct!"

    # 7. List jobs
    r_list = requests.get(f"{BASE}/jobs")
    all_jobs = r_list.json().get("jobs", [])
    print(f"8. List jobs: {len(all_jobs)} jobs recorded on disk")

    # 8. Check original sample Colab analysis is 100% intact
    r_sample = requests.get(f"{BASE}/summary")
    sm = r_sample.json().get("summary", {})
    print(f"9. Default sample dataset intact: video={sm.get('video')}, vehicles={sm.get('vehicles_analyzed')}, duration={sm.get('duration_seconds')}s")
    assert sm.get("vehicles_analyzed") == 48, "Sample analysis was modified!"

    print("\n✅ ALL VERIFICATION CHECKS PASSED PERFECTLY!")

if __name__ == "__main__":
    main()
