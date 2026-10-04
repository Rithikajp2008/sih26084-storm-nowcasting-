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
1. **Interactive GIS Command Center Dashboard with Auto-Zoom (SIH26084 Fix #1)**:
   * Tactical dark theme styled for meteorological and disaster command centers.
   * **Automatic Location Auto-Zoom**: On startup, browser GPS resolves device coordinates and smoothly animates map zoom (`flyTo` zoom 11) to center user location, 30 km monitoring circle, and hyper-local grid.
   * Transparent location failure behavior: if permission is denied, clearly marks location as "Selected Monitoring Region" without fabricating fake GPS coordinates.
   * Multi-basemap support (Google Maps Roadmap, Satellite Hybrid, Google Terrain, OpenStreetMap).
2. **1–3 km Hyper-Local Geographic Grid & State Machine (SIH26084 Fix #2)**:
   * Dynamic 11×11 real geographic grid (~2.8 km resolution = 1–3 km, 121 cells) covering the active 30 km monitoring zone.
   * **State A (Before Analysis)**: Subtle light charcoal/black fill (`rgba(35, 35, 35, 0.34)`), communicating telemetry ingestion & nowcasting analysis in progress.
   * **State B (Evaluated Risk)**: Transitions dynamically to SAFE (light green `rgba(100, 190, 110, 0.30)`) or DANGER (light red `rgba(235, 80, 80, 0.30)`), driven by actual backend analysis.
   * Interactive grid cell popups displaying storm, lightning, hail, rain, wind, and cloudburst probabilities with lead time and data provenance.
3. **Storm-Aware Safe Route Planner (SIH26084 Section 25)**:
   * Integrated into dashboard and Leaflet GIS map with multi-route alternative calculation (OSRM OpenStreetMap routing).
   * **Spatial-Temporal Storm Intersect**: Matches route coordinates with the 1–3 km hazard grid and evaluates user arrival time vs predicted storm arrival time along each segment corridor.
   * **Route Comparison**: Directly compares FASTEST ROUTE vs STORM-AWARE ROUTE (Travel Time, Distance, Storm Exposure Score 0–100, and Risk Level).
   * **Explainability ("Why This Route?")**: Explains reasons for lower-risk route recommendation and warnings for fastest route detour trade-offs.
   * **Forecast Safety Window**: Quantifies time buffer remaining before storm corridor intersection.
4. **Early Convective Initiation (CI) Detection**:
   * Physics-based multi-sensor rules: Rapid cloud-top cooling (< -50°C, rate > 10°C/hr), Radar reflectivity surge (> 45 dBZ, +12 dBZ/hr), and lightning onset detection.
5. **Storm-Cell Detection & Kinematic Tracking**:
   * Cell clustering, centroid identification, intensity dBZ, speed, bearing, and future trajectory projection (+15m, +30m, +1h, +2h, +3h, +6h) with expanding uncertainty cones.
6. **Storm Arrival Countdown & "Rain Coming?" Feature**:
   * Live ticking HH:MM:SS digital countdown timer, estimated clock arrival time, distance in km, and approach vector.
   * Precipitation probability %, intensity tier, duration, and multi-horizon outlook bars.
7. **Independent 5-Hazard Prediction (SIH26084)**:
   * **Thunderstorm**: Probability %, severity tier, arrival time.
   * **Lightning**: Flash probability %, strike density (/km²), strike trend, active strikes.
   * **Hail**: Probability %, risk level, estimated hailstone diameter (cm), affected radius.
   * **Downburst / Severe Wind**: Probability %, max gust (km/h), expected range, direction.
   * **Cloudburst / Extreme Rainfall**: Probability %, rain rate (mm/h), accumulation (mm), risk tier.
8. **0–3h & 0–6h Interactive Nowcast Timeline**:
   * Interactive slider (0 to 180 min in 15 min steps) and play/pause simulation that dynamically advects storm cells and updates grid & route risk across the map.
9. **Explainable AI ("Why This Alert?")**:
   * Relative contribution percentage breakdown of radar reflectivity, satellite cooling, lightning frequency, and surface moisture convergence.
10. **Data-Source Health & Provenance Panel**:
    * Real-time telemetry monitoring for all system components (Radar, Satellite, Lightning, AWS, NWP, ML Engine, Database, WebSocket).


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
Run all 25 automated unit & integration tests:
```bash
$env:PYTHONPATH="."
pytest -v
```
All tests verify:
- Convective Initiation detection & multi-sensor rule fusion
- 5-hazard prediction calculations & probability calibration
- Rain Coming outlook & Storm Arrival countdown
- REST & WebSocket APIs
- 1–3 km Hyper-Local Grid generation (121 cells across 30 km radius)
- Grid State Machine (ANALYZING -> SAFE / DANGER / DATA_UNAVAILABLE)
- Storm-Aware Safe Route Planner POST/GET endpoints, route comparisons, temporal storm overlap, and explainability.

---

## 9. Judge Demonstration Flow (Step-by-Step)
For an impactful presentation, follow this sequence:
1. **Step 1 - Open Dashboard & Auto-Zoom**: Open `http://localhost:8000` (or `http://localhost:5173`). Observe browser GPS auto-resolving device coordinates and smoothly animating map zoom (`flyTo` zoom 11) to center your location, the 30 km early-warning radius, and the hyper-local grid.
2. **Step 2 - 1–3 km Hazard Grid & State Machine**: Observe the 1–3 km geographic grid cells covering the 30 km monitoring zone. Notice State A (subtle charcoal ANALYZING) transitioning to evaluated State B (SAFE light-green outside storm, DANGER light-red inside storm corridor). Click any cell to inspect storm probability, lightning, hail, rain rate, and cloudburst metrics.
3. **Step 3 - Storm Cells & Countdown**: Click on storm cell `CELL-IN-01` to display intensity (56.5 dBZ), motion vector, and 0–6h trajectory cone. Point to the **STORM ARRIVAL COUNTDOWN** card ticking in real-time.
4. **Step 4 - Convective Initiation & 5 Hazards**: Review early CI signals (cloud-top cooling, reflectivity surge) and independent 5-hazard cards for Thunderstorm, Lightning, Hail, Downburst, and Cloudburst.
5. **Step 5 - Storm-Aware Safe Route Planner (Section 25)**:
   * Click **`🚗 SAFE ROUTE PLANNER`** in the sidebar.
   * Click **`[ Use My Current Location ]`** to automatically set origin, and select or enter a destination (e.g., Tambaram Sanatorium or Airport).
   * Click **`[ 🚗 FIND LOWER-RISK ROUTE ]`**.
   * Show the route comparison between **FASTEST ROUTE** (elevated storm exposure) and **STORM-AWARE ROUTE** (recommended lower-risk route).
   * Highlight **"WHY THIS ROUTE?"** explaining how the route avoids high-risk grid cells and temporal storm collision.
   * Point to the **Forecast Safety Window** and interactive route polylines on the map.
6. **Step 6 - 0–3 Hour Interactive Timeline**: Move the 0–3h slider. Watch the storm advect across the grid, updating affected grid cell risk colors and route risk in real-time.
7. **Step 7 - Toggle Real Data Mode**: Click **`[Switch to Real Data]`** in the header. Show that the system honestly reports live WMO/IMD surface observations and transparently displays `NOT_CONNECTED` for unconfigured credentials rather than inventing fake data.


---

## 10. Data Attribution & References
- IMD API Portal: `https://api.imd.gov.in`
- MOSDAC (ISRO) Satellite Archive & Data Products: `https://mosdac.gov.in`
- NCMRWF Unified Model Documentation: `https://www.ncmrwf.gov.in`
- WMO Guidelines on Nowcasting Techniques (WMO-No. 1198)

---

## 11. Disclaimer
This system is an experimental AI-based decision-support prototype. Predictions are model outputs and should not replace authoritative warnings issued by the India Meteorological Department (IMD) or competent government disaster management authorities.
