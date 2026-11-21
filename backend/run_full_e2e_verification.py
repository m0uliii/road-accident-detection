import requests
import time
import json
from pathlib import Path

BASE_URL = "http://127.0.0.1:8000"
video_path = r"C:\Users\lenovo\Downloads\14333302_3840_2160_60fps.mp4"

# 1. Health check
print("Testing /api/health...")
for i in range(10):
    try:
        r = requests.get(f"{BASE_URL}/api/health", timeout=3)
        if r.status_code == 200:
            print("Backend health OK:", r.json())
            break
    except Exception as e:
        time.sleep(1)
else:
    print("Backend failed to start!")
    exit(1)

# 2. Upload video and create job
print(f"\nUploading and creating job for {video_path}...")
with open(video_path, "rb") as f:
    files = {"file": ("14333302_3840_2160_60fps.mp4", f, "video/mp4")}
    r = requests.post(f"{BASE_URL}/api/jobs", files=files)
    r.raise_for_status()
    job_id = r.json()["job_id"]
    print(f"Created Job ID: {job_id}")

# 3. Monitor execution to completion
t0 = time.time()
while True:
    time.sleep(3)
    r = requests.get(f"{BASE_URL}/api/jobs/{job_id}")
    status_data = r.json()
    status = status_data.get("status")
    progress = status_data.get("progress", 0)
    elapsed = time.time() - t0
    print(f"[{elapsed:5.1f}s] Status: {status:10} | Progress: {progress}%")
    if status in ("completed", "failed", "cancelled"):
        break

if status != "completed":
    print(f"FAILED: Job finished with status {status}")
    exit(1)

total_processing_time = time.time() - t0
print(f"\nProcessing COMPLETED in {total_processing_time:.2f}s!")

# 4. Fetch Analysis JSON
r_analysis = requests.get(f"{BASE_URL}/api/jobs/{job_id}/analysis")
analysis = r_analysis.json()

# 5. Fetch Summary
r_summary = requests.get(f"{BASE_URL}/api/summary?job_id={job_id}")
summary = r_summary.json()["summary"]

# 6. Verify Video Streaming
r_head = requests.head(f"{BASE_URL}/api/jobs/{job_id}/video")
r_range = requests.get(f"{BASE_URL}/api/jobs/{job_id}/video", headers={"Range": "bytes=0-1024"})
print(f"\nVideo Streaming Verification:")
print(f"  HEAD Status: {r_head.status_code}, Content-Type: {r_head.headers.get('content-type')}, Accept-Ranges: {r_head.headers.get('accept-ranges')}")
print(f"  Range GET Status: {r_range.status_code}, Content-Range: {r_range.headers.get('content-range')}")

# 7. Analyze vehicle metrics
vehicles = analysis.get("vehicles", [])
durations = [v["frames_tracked"] for v in vehicles]
dur_1 = sum(1 for d in durations if d == 1)
dur_2_4 = sum(1 for d in durations if 2 <= d <= 4)
dur_5plus = sum(1 for d in durations if d >= 5)
dur_10plus = sum(1 for d in durations if d >= 10)
dur_20plus = sum(1 for d in durations if d >= 20)

assessable = [v for v in vehicles if v.get("observation_quality") == "sufficient"]
insufficient = [v for v in vehicles if v.get("observation_quality") == "insufficient"]

scores = [v["risk_score"] for v in assessable if v["risk_score"] is not None]
events = analysis.get("events", [])

print("\n=======================================================")
print("END-TO-END VALIDATION SUMMARY")
print("=======================================================")
print(f"Job ID: {job_id}")
print(f"Video: {analysis.get('video')}")
print(f"Total Frames Processed: {analysis.get('frames_processed')} (duration: {analysis.get('duration_seconds')}s)")
print(f"Raw Tracking IDs Observed: {analysis.get('tracking_ids_observed')}")
print(f"Total Vehicle Records: {len(vehicles)}")
print(f"Assessable Vehicles (>= 2 frames): {len(assessable)}")
print(f"Insufficient Data Vehicles (1 frame): {len(insufficient)}")
print(f"Track Length Distribution:")
print(f"  - 1 frame (insufficient): {dur_1}")
print(f"  - 2 to 4 frames (instantaneous/brief): {dur_2_4}")
print(f"  - 5+ frames (solid tracking): {dur_5plus}")
print(f"  - 10+ frames (extended tracking): {dur_10plus}")
print(f"  - 20+ frames (long tracking): {dur_20plus}")
if durations:
    print(f"  - Max track length: {max(durations)} frames ({max(durations)/29.97:.2f}s)")
    print(f"  - Average track length: {sum(durations)/len(durations):.1f} frames")

print(f"\nRisk Assessment:")
print(f"  - Peak Valid Risk Score: {summary.get('max_risk_score')}/100")
print(f"  - Average Valid Risk Score: {summary.get('average_risk_score')}/100")
print(f"  - High-Risk Tracks (>= 65): {summary.get('risk_distribution', {}).get('high')}")
print(f"  - Medium-Risk Tracks (35-64): {summary.get('risk_distribution', {}).get('medium')}")
print(f"  - Low-Risk Tracks (0-34): {summary.get('risk_distribution', {}).get('low')}")
print(f"  - Unassessable Tracks: {summary.get('risk_distribution', {}).get('unassessable')}")
print(f"  - Motion Anomalies Detected: {len(events)}")

print(f"\nIndividual Vehicle Records:")
for v in vehicles:
    print(f"  V-{v['id']:<3} | type={v['type']:<5} | frames={v['frames_tracked']:<2} | span={v['first_seen']:.3f}s->{v['last_seen']:.3f}s "
          f"| avg_motion={str(v['average_motion_px_s']):<7} px/s | abrupt={v['abrupt_motion_changes']} "
          f"| risk={str(v['risk_score']):<4} | level={v['risk_level']:<12} | obs={v['observation_quality']}")

print(f"\nConsistency Checks:")
print(f"  summary.vehicles_analyzed == len(vehicles): {summary.get('vehicles_analyzed') == len(vehicles)} ({summary.get('vehicles_analyzed')})")
print(f"  summary.vehicles_assessable == len(assessable): {summary.get('vehicles_assessable') == len(assessable)} ({summary.get('vehicles_assessable')})")
print(f"  summary.vehicles_unassessable == len(insufficient): {summary.get('vehicles_unassessable') == len(insufficient)} ({summary.get('vehicles_unassessable')})")
print(f"  summary.max_risk_score == max(scores): {summary.get('max_risk_score') == max(scores)} ({summary.get('max_risk_score')})")
print(f"  summary.average_risk_score == round(mean(scores), 2): {summary.get('average_risk_score') == round(sum(scores)/len(scores), 2)} ({summary.get('average_risk_score')})")
