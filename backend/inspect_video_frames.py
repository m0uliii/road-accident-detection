import cv2
import numpy as np

video_path = r"C:\Users\lenovo\Downloads\14333302_3840_2160_60fps.mp4"
cap = cv2.VideoCapture(video_path)

total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS)
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

print(f"Video Info: {w}x{h} @ {fps:.2f}fps, total_frames={total_frames}, duration={total_frames/fps:.2f}s")

# Let's save a thumbnail or check pixel stats of frame 0 and frame 180
for f_idx in [0, 60, 120, 180, 240, 300, 360]:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
    ret, frame = cap.read()
    if ret:
        print(f"Frame {f_idx}: shape={frame.shape}, mean_bgr={frame.mean(axis=(0,1))}")

cap.release()
