# SIH26084: Real-Time Convective Storm Nowcasting System (0–6 Hr)

### Ministry of Earth Sciences (MoES) | National Centre for Medium Range Weather Forecasting (NCMRWF)
**Theme**: Disaster Management | **Category**: Software | **Resolution**: 1–3 km Hyper-Local

---

## 1. Project Overview
This repository contains a **real-data-first, 0–6 hour convective-scale nowcasting and hyper-local early-warning prototype for India**, built specifically for **SIH26084** (Convective scale nowcasting for Thunderstorms, Hail & Cloudbursts).

Severe convective storms—including sudden thunderstorms, damaging hailstorms, downbursts, and flash cloudbursts—develop rapidly within 15–30 minutes, often slipping through traditional coarse numerical models. This platform bridges that gap by fusing Doppler Weather Radar (DWR) reflectivity, INSAT-3D/3DR geostationary satellite infrared imagery, ground-based lightning network feeds, and surface Automated Weather Stations (AWS) into a high-resolution 1–3 km hazard grid with real-time tracking, ETA countdowns, and operational decision-support advisories.

---

## 2. REAL-DATA-FIRST Architecture
In strict adherence to scientific and competition integrity:
- **REAL DATA MODE (`DATA_MODE=real`)**:
  * Ingests live data from configured official/WMO-compliant feeds.
  * If official Doppler Radar, INSAT, or Lightning credentials are not yet configured in `.env`, the system **refuses to fabricate synthetic data**. It reports `NOT_CONNECTED / CREDENTIALS REQUIRED` with transparent status badges.
- **DEMO / SIMULATION MODE (`DATA_MODE=demo`)**:
  * Provides a complete, realistic, interactive demonstration scenario of an intensifying severe convective storm in the coastal Bay of Bengal / Chennai sector.
  * Prominently labeled with a **`🟡 DEMO / SIMULATION DATA`** banner across all views.
  * Allows judges to evaluate the full end-to-end operational workflow without requiring confidential institutional credentials.
- **1-Click Live Switcher**:
  * Judges can toggle between Real Mode and Demo Mode instantly directly from the UI header or via API.

---

## 3. Key System Features
1. **Interactive GIS Command Center Dashboard**:
   * Tactical dark theme styled for meteorological and disaster command centers.
   * Multi-basemap support (Carto Dark, Satellite Hybrid, OpenStreetMap).
   * Layer controls: 1–3 km Hazard Grid, DWR Reflectivity colormaps, Storm Cells, 0–6h Trajectory Cone, Lightning Strikes, Convective Initiation (CI) Hotspots, and 3 km User Buffer.
2. **Early Convective Initiation (CI) Detection**:
   * Physics-based multi-sensor rules: Rapid cloud-top cooling (< -50°C, rate > 10°C/hr), Radar reflectivity surge (> 45 dBZ, +12 dBZ/hr), and lightning onset detection.
3. **Storm-Cell Detection & Kinematic Tracking**:
   * Cell clustering, centroid identification, intensity dBZ, speed, bearing, and future trajectory projection (+15m, +30m, +1h, +2h, +3h, +6h) with expanding uncertainty cones.
4. **Storm Arrival Countdown & "Rain Coming?" Feature**:
   * Live ticking HH:MM:SS digital countdown timer, estimated clock arrival time, distance in km, and approach vector.
   * Precipitation probability %, intensity tier, duration, and multi-horizon outlook bars.
5. **Independent 5-Hazard Prediction (SIH26084)**:
   * **Thunderstorm**: Probability %, severity tier, arrival time.
   * **Lightning**: Flash probability %, strike density (/km²), strike trend, active strikes.
   * **Hail**: Probability %, risk level, estimated hailstone diameter (cm), affected radius.
   * **Downburst / Severe Wind**: Probability %, max gust (km/h), expected range, direction.
   * **Cloudburst / Extreme Rainfall**: Probability %, rain rate (mm/h), accumulation (mm), risk tier.
6. **0–6 Hour Nowcast Timeline**:
   * Interactive timeline scrubber with play/pause simulation that automatically steps through forecast horizons and advects storm cells across the map.
7. **Explainable AI ("Why This Alert?")**:
   * Relative contribution percentage breakdown of radar reflectivity, satellite cooling, lightning frequency, and surface moisture convergence.
8. **Data-Source Health & Provenance Panel**:
   * Real-time telemetry monitoring for all 8 system components (Radar, Satellite, Lightning, AWS, NWP, ML Engine, Database, WebSocket).

---

## 4. Architecture Diagram

```text
       MULTI-SOURCE DATA INGESTION
 ┌──────────────┬──────────────┬──────────────┬──────────────┐
 │   IMD DWR    │ INSAT-3D/3DR │  LIGHTNING   │  SURFACE AWS │
 │ Reflectivity │  Satellite   │ Ground Net   │  & Rain Gs   │
 └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘
        ▼              ▼              ▼              ▼
 ┌───────────────────────────────────────────────────────────┐
 │       Data Quality Control (Range, Sanity, Staleness)     │
 └─────────────────────────────┬─────────────────────────────┘
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │               Multi-Source Meteorological Fusion           │
 └─────────────────────────────┬─────────────────────────────┘
                               ▼
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
 ┌──────────────────────────┐                  ┌──────────────────────────┐
 │  Convective Initiation   │                  │   Storm-Cell Tracking    │
 │       (CI) Engine        │                  │   & Trajectory Engine    │
 └──────────────┬───────────┘                  └──────────────┬───────────┘
                └──────────────────────┬──────────────────────┘
                                       ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      AI / ML Nowcasting Engine                         │
 │     Multi-Hazard Prediction: Rain • Lightning • Hail • Wind • Cloudburst│
 └─────────────────────────────────────┬──────────────────────────────────┘
                                       ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │           1–3 km Hyper-Local Spatial Hazard Grid (0–6 Hours)           │
 └─────────────────────────────────────┬──────────────────────────────────┘
                                       ▼
               ┌───────────────────────┴───────────────────────┐
               ▼                                               ▼
 ┌───────────────────────────┐                   ┌───────────────────────────┐
 │    FastAPI REST & WS      │                   │    PostgreSQL / PostGIS   │
 │        Endpoints          │                   │       Spatial Store       │
 └─────────────┬─────────────┘                   └───────────────────────────┘
               ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │            Meteorological Operations GIS Command Center                │
 │         Leaflet GIS • Arrival Countdown • Tactical Advisory            │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Technology Stack
- **Frontend**: React 19, TypeScript, Leaflet / React-Leaflet, Vanilla CSS Design System, Vite
- **Backend**: FastAPI, Python 3.12/3.14, Uvicorn, WebSockets, Pydantic v2
- **Data & GIS**: PostGIS (PostgreSQL 16), GeoJSON, Shapely, PyProj
- **Machine Learning**: Scikit-Learn (HistGradientBoosting), NumPy, Pandas, Joblib
- **Caching & Real-Time**: Redis 7
- **Deployment**: Docker & Docker Compose

---

## 6. Installation & Run Instructions

### Option 1: Docker Compose (One-Command Setup)
```bash
# Clone or navigate to project directory
cd SIH26084_STORM_NOWCASTING

# Copy environment template
cp .env.example .env

# Build and start all containers (Frontend, Backend, PostGIS, Redis)
docker compose up --build
```
- **GIS Dashboard**: `http://localhost:5173`
- **FastAPI OpenAPI Swagger**: `http://localhost:8000/docs`

### Option 2: Local Development (Without Docker)
1. **Backend**:
   ```bash
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # Linux/Mac:
   source .venv/bin/activate

   pip install -r backend/requirements.txt
   $env:PYTHONPATH="."
   uvicorn backend.app.main:app --reload --port 8000
   ```
2. **Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

## 7. Machine Learning Pipeline & Verification

### Prepare Dataset, Train, and Evaluate
```bash
# 1. Train model on verified/sample convective events
$env:PYTHONPATH="."
python ml/training/train_model.py --data demo/sample_data/convective_events_sample.csv --out ml/artifacts/model.joblib

# 2. Evaluate using official WMO/MoES verification metrics
python ml/evaluation/evaluate_model.py --data demo/sample_data/convective_events_sample.csv --model ml/artifacts/model.joblib
```

### Verification Metrics Output:
- **CSI (Critical Success Index / Threat Score)**
- **POD (Probability of Detection / Hit Rate)**
- **FAR (False Alarm Ratio)**
- **ROC-AUC & Brier Score**
- **2x2 Contingency Table (Hits, False Alarms, Misses, Correct Negatives)**

---

## 8. Automated Tests
Run all 19 automated tests:
```bash
$env:PYTHONPATH="."
pytest -v
```
All tests cover API endpoints, ETA calculations, storm advection, invalid coordinate rejection, convective initiation detection, multi-hazard prediction, and WebSocket streams.

---

## 9. Judge Demonstration Flow (Step-by-Step)
For an impactful Hackathon presentation, follow this sequence:
1. **Step 1 - Open Dashboard**: Open `http://localhost:5173`. Show the dark command center aesthetic, MoES/NCMRWF header, live IST and UTC clocks, and data-source health status.
2. **Step 2 - Review Current Weather**: Select "Chennai (Demo Hotspot)" or click anywhere on the Indian map. Observe live temperature, humidity, pressure, wind, and data provenance.
3. **Step 3 - Inspect Approaching Storm**: On the map, observe the convective storm cell (`CELL-IN-01`) with its 56.5 dBZ reflectivity core and motion vector heading North-East.
4. **Step 4 - Click Storm Cell**: Click the cell on the map to display telemetry: reflectivity dBZ, speed, bearing, area in km², and age.
5. **Step 5 - Show Arrival Countdown**: Point to the **STORM ARRIVAL COUNTDOWN** card ticking in real-time (`00:18:42`, distance 12.6 km, confidence 82%).
6. **Step 6 - Show "Rain Coming?"**: Highlight the verdict banner: `YES – HIGH PROBABILITY (82%)`, arrival in 18 min, and multi-timestep outlook bars (+15m to +6h).
7. **Step 7 - Convective Initiation (CI)**: Open the CI card showing early signals: cloud-top cooling (-64.5°C at 16.8°C/hr) and radar core growth (+19.2 dBZ/hr).
8. **Step 8 - Inspect The 5 Hazards**: Review independent hazard cards for Thunderstorm, Lightning, Hail (size cm), Downburst (max gust km/h), and Cloudburst (rain rate mm/h).
9. **Step 9 - Simulate 0–6 Hour Timeline**: Click **`▶ SIMULATE 0–6H`** on the bottom scrubber. Watch the storm cell advect across the map and hazard probabilities evolve dynamically.
10. **Step 10 - Explainability ("Why This Alert?")**: Show the percentage feature impact breakdown justifying why the warning was triggered.
11. **Step 11 - Toggle Real Data Mode**: Click **`[Switch to Real Data]`** in the header. Show that the system honestly reports real WMO/IMD surface observations and transparently displays `NOT_CONNECTED` for unconfigured radar/satellite credentials rather than inventing fake data.

---

## 10. Data Attribution & References
- IMD API Portal: `https://api.imd.gov.in`
- MOSDAC (ISRO) Satellite Archive & Data Products: `https://mosdac.gov.in`
- NCMRWF Unified Model Documentation: `https://www.ncmrwf.gov.in`
- WMO Guidelines on Nowcasting Techniques (WMO-No. 1198)

---

## 11. Disclaimer
This system is an experimental AI-based decision-support prototype. Predictions are model outputs and should not replace authoritative warnings issued by the India Meteorological Department (IMD) or competent government disaster management authorities.
