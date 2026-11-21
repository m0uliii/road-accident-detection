# RoadWatch — Road Accident and Dangerous Driving Detection System

A professional full-stack web application that visualises vehicle tracking results,
motion analysis, risk scores and detected anomalies from a YOLO11n + ByteTrack pipeline.

## Tech Stack

| Layer    | Technology                            |
|----------|---------------------------------------|
| Frontend | React 18, Vite, Tailwind CSS, Recharts|
| Backend  | Python, FastAPI, Uvicorn              |
| Data     | JSON file — `backend/data/analysis.json` |

---

## Project Structure

```
roadwatch/
├── frontend/           React + Vite application
│   ├── public/videos/  Place annotated video files here
│   └── src/
│       ├── components/ Sidebar.jsx, Layout.jsx
│       ├── pages/      Overview, VideoAnalysis, Vehicles, Incidents, Reports
│       └── services/   api.js (fetch wrapper)
├── backend/
│   ├── data/           Place analysis.json here
│   ├── main.py         FastAPI app
│   └── requirements.txt
└── README.md
```

---

## Setup

### 1. Backend

```bash
cd roadwatch/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at **http://127.0.0.1:8000**

> Place your `analysis.json` Colab output at `backend/data/analysis.json`
> before starting the server. The backend will return a clear missing-data
> response until the file exists.

### 2. Frontend

```bash
cd roadwatch/frontend
npm install
npm run dev
```

The UI will be available at **http://localhost:5173**

---

## API Endpoints

| Method | Endpoint         | Description                        |
|--------|------------------|------------------------------------|
| GET    | `/api/health`    | System health + data file status   |
| GET    | `/api/analysis`  | Full raw analysis JSON             |
| GET    | `/api/summary`   | Derived statistics from real data  |
| GET    | `/api/vehicles`  | Tracked vehicle list               |
| GET    | `/api/events`    | Detected motion anomaly events     |

Interactive docs: **http://127.0.0.1:8000/docs**

---

## Data Notes

- Vehicle motion is measured in **pixels/second**, not km/h.
- Risk scores are **heuristic indicators (0–100)**, not statistical probabilities.
- Motion anomalies are **not confirmed accidents**.
- This system analyses **recorded video footage**, not live CCTV.
- No vehicle identities, GPS locations or license plates are inferred.

---

## Development Phases

| Phase | Scope                                     | Status      |
|-------|-------------------------------------------|-------------|
| 1     | Project setup, layout, backend, navigation| ✅ Complete |
| 2     | Overview dashboard (KPIs, risk timeline)  | Pending     |
| 3     | Video Analysis page                       | Pending     |
| 4     | Vehicles table page                       | Pending     |
| 5     | Incidents log page                        | Pending     |
| 6     | Reports export page                       | Pending     |
