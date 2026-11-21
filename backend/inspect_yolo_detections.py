import cv2
from ultralytics import YOLO
import numpy as np

video_path = r"C:\Users\lenovo\Downloads\14333302_3840_2160_60fps.mp4"
model_path = r"C:\Users\lenovo\Downloads\image and vdo project\roadwatch\backend\yolo11n.pt"

model = YOLO(model_path)

cap = cv2.VideoCapture(video_path)
frames = []
for i in range(30):
    ret, frame = cap.read()
    if not ret:
        break
    frames.append(frame)
cap.release()

print(f"Read {len(frames)} frames.")

# Test combinations of (imgsz, conf) on these 30 frames
configs = [
    ("640, conf=0.20", 640, 0.20),
    ("640, conf=0.10", 640, 0.10),
    ("640, conf=0.05", 640, 0.05),
    ("960, conf=0.15", 960, 0.15),
    ("960, conf=0.10", 960, 0.10),
    ("1280, conf=0.15", 1280, 0.15),
    ("1280, conf=0.10", 1280, 0.10),
    ("1280, conf=0.05", 1280, 0.05),
    ("1536, conf=0.10", 1536, 0.10),
]

for name, imgsz, conf in configs:
    det_counts = []
    confs_all = []
    for f in frames:
        # resize preserving aspect ratio
        h, w = f.shape[:2]
        target_w = imgsz
        target_h = int(round((target_w / w) * h))
        if target_h % 2 != 0:
            target_h += 1
        resized = cv2.resize(f, (target_w, target_h), interpolation=cv2.INTER_AREA)

        # Predict
        res = model.predict(resized, classes=[2, 3, 5, 7], conf=conf, imgsz=imgsz, verbose=False, device="cpu")
        if res and len(res) > 0 and res[0].boxes is not None:
            boxes = res[0].boxes
            det_counts.append(len(boxes))
            confs_all.extend(boxes.conf.tolist())
        else:
            det_counts.append(0)

    avg_det = sum(det_counts) / len(det_counts)
    nonzero_frames = sum(1 for c in det_counts if c > 0)
    avg_conf = sum(confs_all) / len(confs_all) if confs_all else 0
    print(f"Config: {name:16} | Avg Det/frame: {avg_det:4.2f} | Frames with >=1 det: {nonzero_frames}/{len(frames)} | Avg Conf: {avg_conf:.3f} | Max Det: {max(det_counts)}")
