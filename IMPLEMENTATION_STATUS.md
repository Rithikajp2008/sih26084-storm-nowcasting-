# SIH26084 Implementation Status Report

## System Overview
- **Problem Statement ID**: SIH26084
- **Title**: Convective scale nowcasting for Thunderstorms, Hail & Cloudbursts (06 hr)
- **Organization**: Ministry of Earth Sciences (MoES) / National Centre for Medium Range Weather Forecasting (NCMRWF)
- **Theme**: Disaster Management

---

## 1. What Was Already Present in the Uploaded Base
- Initial skeleton project with FastAPI backend, React frontend, and basic Leaflet map.
- Baseline constant-velocity ETA calculation function.
- Initial IMD, MOSDAC, Radar, and Lightning adapter stubs.
- 9 initial core unit tests.
- Docker compose file with PostgreSQL and Redis.
- Basic mock grid with storm advection.

---

## 2. What Was Fixed
- **Vite/TypeScript Build Failure**: Fixed missing `vite/client` type definitions in `frontend/src/vite-env.d.ts` and `frontend/tsconfig.json`, allowing clean zero-error production builds.
- **StormCell Pydantic Schema Divergence**: Fixed `storm_id` vs `cell_id` field compatibility in `backend/app/core/schemas.py`, ensuring backwards compatibility with existing tests while supporting modern cell tracking fields.
- **ETA=0 and Distance Boundary Conditions**: Preserved exact 0 min handling for points within the storm footprint while accurately computing ~18 min arrival for upstream locations.
- **Frontend Dependency Pinning**: Verified `npm install` and strict TypeScript compilation with Leaflet, React 19, and Vite.
- **Duplicate Code in Demo Generator**: Cleaned up duplicated advection calculations in `backend/app/services/demo.py`.

---

## 3. What Was Added
- **Complete SIH26084 Five-Hazard Predictor**:
  * Thunderstorm (Probability, Severity, Arrival ETA)
  * Lightning (Probability, Strike density/km², Trend, Count)
  * Hail (Probability, Risk tier, Diameter in cm, Affected radius)
  * Downburst / Severe Wind (Probability, Max gust km/h, Range km/h, Direction)
  * Cloudburst / Extreme Rainfall (Probability, Rain rate mm/h, Accumulation mm, Duration)
- **Early Convective Initiation (CI) Engine** (`ci_detector.py`):
  * Multi-sensor physical threshold detection: Cloud-top cooling (< -50°C, rate > 10°C/hr), Radar reflectivity surge (> 45 dBZ, +12 dBZ/hr), and ground lightning onset.
- **Storm-Cell Tracking & Multi-Timestep Trajectory Engine** (`tracking.py`):
  * Future waypoint projection (+15m, +30m, +1h, +2h, +3h, +6h) with expanding uncertainty cone radius.
- **Live Storm Arrival Countdown**:
  * Real-time digital clock (HH:MM:SS), clock arrival time, distance in km, approach bearing.
- **“Rain Coming?” Early-Warning Feature**:
  * High-probability verdict banner, arrival time, intensity, duration, and multi-timestep outlook bars (+15m, +30m, +1h, +3h, +6h).
- **Explainable AI Predictions ("Why This Alert?")**:
  * Factor contribution percentages and data provenance tracking.
- **1-Click Live Mode Switcher**:
  * Allows judges to instantly toggle between `🟢 REAL DATA MODE` and `🟡 DEMO / SIMULATION MODE` directly from the dashboard header and API (`POST /api/mode/toggle`).
- **Real Meteorological Data Adapter** (`real_weather.py`):
  * WMO Open Surface & IMD AWS telemetry adapter for any coordinate in India, ensuring real surface weather observations without fabricating numbers.
- **Official Meteorological Verification Metrics**:
  * Upgraded `ml/evaluation/evaluate_model.py` with Critical Success Index (CSI), Probability of Detection (POD), False Alarm Ratio (FAR), and Brier Score.
- **Command Center Dashboard Interface**:
  * Complete UI overhaul styled as a MoES / NCMRWF Meteorological Operations & Disaster Management Command Center with glassmorphism cards, glowing badges, live IST/UTC clocks, base map switcher, and layer toggles.
- **Expanded Test Suite**:
  * 19 comprehensive automated tests in `tests/test_core.py` and `tests/test_sih26084.py`, all passing.
- **Expanded PostGIS Database Schema**:
  * 12 spatial tables with Point/Polygon geometry types and spatial GIST indexes in `database/schema.sql`.

---

## 4. What Is Fully Functional
1. **Interactive GIS Map**: Fully interactive Leaflet map with Carto Dark, Satellite, and OSM basemaps.
2. **Layer Overlays**: 1–3 km Hazard Grid, DWR Radar Reflectivity colormap, Storm Cells, 0–6h Trajectory Cone, Lightning Strikes, CI Hotspots, and 3 km User Buffer.
3. **0–6 Hour Nowcast Timeline**: Play/pause animated simulation advancing through +15m, +30m, +1h, +2h, +3h, +6h with automatic map updates.
4. **Location Inspection**: Quick Indian city presets (Chennai, Mumbai, Delhi, Kolkata, Bengaluru, etc.) and click-anywhere-on-map coordinate inspection.
5. **Real-Time WebSocket**: Live updates broadcasting every few seconds to the dashboard without manual page refreshes.
6. **REST APIs**: Full OpenAPI/Swagger documentation at `http://localhost:8000/docs`.
7. **ML Training & Evaluation**: Verified pipeline for dataset preparation, training (`train_model.py`), and evaluation (`evaluate_model.py`).

---

## 5. What Requires Real Credentials (Honest Scientific Boundaries)
In accordance with SIH26084 REAL-DATA-FIRST guidelines, the system refuses to fabricate data in `REAL DATA MODE`:
- **Doppler Weather Radar (DWR)**: Requires `IMD_RADAR_URL` set to an authorized machine-readable DWR feed (e.g. NetCDF/UF/BUFR). If not configured, reports `NOT_CONNECTED`.
- **INSAT-3D / 3DR Satellite**: Requires `MOSDAC_USERNAME`, `MOSDAC_PASSWORD`, and `MOSDAC_DATASET_ID` for authenticated ISRO/MOSDAC NRT API downloads.
- **Ground Lightning Detection**: Requires `LIGHTNING_API_URL` and `LIGHTNING_API_KEY` for authorized proprietary lightning sensor networks (e.g., Earth Networks or IMD Damini backend).
- **Official IMD Portal**: Uses `IMD_API_KEY` when official IMD API gateway credentials are provided. Falls back gracefully to open WMO ground telemetry for real surface weather.

---

## 6. What Is Demo Mode
When `DATA_MODE=demo` is active (or toggled via UI):
- The dashboard prominently displays: `🟡 DEMO / SIMULATION MODE`.
- Simulates a severe convective squall line near the Bay of Bengal / Chennai coastal sector advecting North-East at 38 km/h.
- Demonstrates rapid convective initiation (-64.5°C cloud-top cooling, 56.5 dBZ reflectivity core surge, 8 lightning strikes).
- Generates 1–3 km spatial resolution hazard grid cells, live arrival countdown, 5-hazard prediction metrics, and 0–6h advection animation.

---

## 7. Test Results
Automated test run using `pytest`:
```text
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.1.1, pluggy-1.6.0
rootdir: C:\Users\Rithika\Documents\SIH 2
collected 19 items

tests/test_core.py::test_eta_on_path_positive PASSED                     [  5%]
tests/test_core.py::test_eta_opposite_direction_is_none PASSED           [ 10%]
tests/test_core.py::test_eta_inside_storm_is_zero PASSED                 [ 15%]
tests/test_core.py::test_projection_moves_in_bearing_direction PASSED    [ 21%]
tests/test_core.py::test_demo_grid_advects_with_time PASSED              [ 26%]
tests/test_core.py::test_api_demo_smoke PASSED                           [ 31%]
tests/test_core.py::test_zero_eta_not_lost PASSED                        [ 36%]
tests/test_core.py::test_invalid_coordinates_rejected PASSED             [ 42%]
tests/test_core.py::test_websocket_demo_stream PASSED                    [ 47%]
tests/test_sih26084.py::test_convective_initiation_detection PASSED      [ 52%]
tests/test_sih26084.py::test_hazard_summary_five_hazards PASSED          [ 57%]
tests/test_sih26084.py::test_rain_coming_feature PASSED                  [ 63%]
tests/test_sih26084.py::test_storm_arrival_countdown PASSED              [ 68%]
tests/test_sih26084.py::test_api_convective_initiation_endpoint PASSED   [ 73%]
tests/test_sih26084.py::test_api_hazards_endpoint PASSED                 [ 78%]
tests/test_sih26084.py::test_api_current_weather_endpoint PASSED         [ 84%]
tests/test_sih26084.py::test_api_lightning_endpoint PASSED               [ 89%]
tests/test_sih26084.py::test_api_why_alert_explainability PASSED         [ 94%]
tests/test_sih26084.py::test_mode_toggle_endpoint PASSED                 [100%]

======================= 19 passed in 0.59s ========================
```

---

## 8. Run Instructions

### A. Run with Docker (Recommended)
```bash
# Start all services (Backend, Frontend, PostgreSQL/PostGIS, Redis)
docker compose up --build
```
- **Frontend Command Center**: `http://localhost:5173`
- **Backend API & Swagger Docs**: `http://localhost:8000/docs`

### B. Run Locally without Docker
1. **Backend**:
   ```bash
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
3. **Execute Tests**:
   ```bash
   $env:PYTHONPATH="."
   pytest -v
   ```
4. **Train & Evaluate ML Baseline**:
   ```bash
   $env:PYTHONPATH="."
   python ml/training/train_model.py --data demo/sample_data/convective_events_sample.csv --out ml/artifacts/model.joblib
   python ml/evaluation/evaluate_model.py --data demo/sample_data/convective_events_sample.csv --model ml/artifacts/model.joblib
   ```
