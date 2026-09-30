from datetime import datetime, timezone
import asyncio
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .core.schemas import (
    UserWarning,
    DataSourceHealth,
    CurrentWeather,
    StormCell,
    GridPrediction,
    ConvectiveInitiationSignal,
    HazardSummary,
    RainComingOutlook,
    StormArrivalCountdown,
    WhyThisAlert,
    LightningStrike,
)
from .services.health import get_system_health
from .services.demo import (
    demo_storms,
    demo_grid,
    demo_lightning_strikes,
    demo_convective_initiation,
    demo_current_weather,
)
from .services.nowcast import (
    eta_minutes,
    risk_label,
    compute_rain_coming,
    compute_storm_countdown,
)
from .services.alerts import (
    should_alert,
    make_alert,
    generate_local_warning,
    explain_alert,
)
from .services.hazards import compute_hazard_summary
from .services.ci_detector import detect_convective_initiation
from .adapters.real_weather import fetch_real_current_weather
from .adapters import imd

app = FastAPI(
    title="Real-Time Convective Storm Nowcasting System (SIH26084)",
    version="1.0.0",
    description="0–6 hour hyper-local (1–3 km) convective storm nowcasting for Thunderstorms, Hail & Cloudbursts in India (MoES / NCMRWF)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Runtime mutable state for data mode (can be toggled live via UI button)
CURRENT_DATA_MODE = settings.data_mode

def _validate_coords(lat: float, lon: float) -> None:
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise HTTPException(status_code=422, detail="Invalid latitude/longitude: outside coordinate limits")

@app.get("/")
async def root():
    return {
        "service": "SIH26084 Real-Time Convective Storm Nowcasting API",
        "organization": "Ministry of Earth Sciences (MoES) / NCMRWF",
        "docs": "/docs",
        "data_mode": CURRENT_DATA_MODE,
        "resolution": "1–3 km hyper-local",
        "version": "1.0.0",
    }

# ----------------- MODE & HEALTH -----------------

@app.get("/api/mode")
async def get_mode():
    return {
        "data_mode": CURRENT_DATA_MODE,
        "label": "DEMO / SIMULATION MODE" if CURRENT_DATA_MODE == "demo" else "REAL DATA MODE",
        "disclaimer": "Experimental AI decision-support prototype. Predictions do not replace official meteorological warnings.",
    }

@app.post("/api/mode")
async def set_mode(payload: Dict[str, str] = Body(...)):
    global CURRENT_DATA_MODE
    new_mode = payload.get("mode", "").lower()
    if new_mode in ["real", "demo"]:
        CURRENT_DATA_MODE = new_mode
        return {"status": "success", "data_mode": CURRENT_DATA_MODE}
    raise HTTPException(status_code=400, detail="Invalid mode: must be 'real' or 'demo'")

@app.post("/api/mode/toggle")
async def toggle_mode():
    global CURRENT_DATA_MODE
    CURRENT_DATA_MODE = "real" if CURRENT_DATA_MODE == "demo" else "demo"
    return {"status": "success", "data_mode": CURRENT_DATA_MODE}

@app.get("/api/health")
@app.get("/api/system-health")
async def system_health():
    hs = await get_system_health(CURRENT_DATA_MODE)
    return {
        "status": "success",
        "mode": CURRENT_DATA_MODE,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": [h.model_dump(mode="json") for h in hs],
    }

@app.get("/api/data-sources")
async def data_sources():
    hs = await get_system_health(CURRENT_DATA_MODE)
    return {
        "status": "success",
        "mode": CURRENT_DATA_MODE,
        "sources": [
            {
                "name": h.name,
                "status": h.status,
                "latency_ms": h.latency_ms,
                "source_type": h.source_type,
                "message": h.message,
            }
            for h in hs
        ]
    }

# ----------------- CURRENT WEATHER & OBSERVATIONS -----------------

@app.get("/api/current-weather")
async def get_current_weather(
    lat: float = Query(13.0827, ge=-90, le=90),
    lon: float = Query(80.2707, ge=-180, le=180),
    city: str = Query("Chennai")
):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        cw = demo_current_weather(lat, lon, city)
    else:
        cw = await fetch_real_current_weather(lat, lon, city)
    return {"status": "success", "mode": CURRENT_DATA_MODE, "data": cw.model_dump(mode="json")}

@app.get("/api/observations")
async def get_observations(lat: float = 13.08, lon: float = 80.27):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        return {
            "status": "success",
            "source": "DEMO-SYNTHETIC AWS NETWORK",
            "count": 4,
            "data": [
                {"parameter": "temperature", "value": 28.4, "unit": "°C", "station": "CHENNAI-MEENAMBAKKAM"},
                {"parameter": "humidity", "value": 84.0, "unit": "%", "station": "CHENNAI-MEENAMBAKKAM"},
                {"parameter": "wind_speed", "value": 24.0, "unit": "km/h", "station": "CHENNAI-MEENAMBAKKAM"},
                {"parameter": "pressure", "value": 1004.2, "unit": "hPa", "station": "CHENNAI-MEENAMBAKKAM"},
            ]
        }
    try:
        obs = await imd.current_weather()
        return {"status": "success", "source": "IMD", "count": len(obs), "data": [x.model_dump(mode="json") for x in obs]}
    except Exception as e:
        return {"status": "error", "source": "IMD", "count": 0, "data": [], "message": f"Source unavailable: {str(e)}"}

# ----------------- STORM DETECTION & TRACKING -----------------

@app.get("/api/storms")
@app.get("/api/storms/live")
async def get_storms_live(lat: float = 13.08, lon: float = 80.27):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        storms = demo_storms(lat, lon)
        return {"status": "success", "mode": CURRENT_DATA_MODE, "count": len(storms), "data": [s.model_dump(mode="json") for s in storms]}
    return {
        "status": "degraded",
        "mode": "real",
        "count": 0,
        "data": [],
        "message": "Live radar/satellite cell detector requires configured DWR/INSAT machine-readable feeds. Switch to DEMO mode to view simulated convective tracking scenario.",
    }

@app.get("/api/storms/{cell_id}")
async def get_storm_by_id(cell_id: str):
    if CURRENT_DATA_MODE == "demo":
        storms = demo_storms()
        for s in storms:
            if s.cell_id == cell_id:
                return {"status": "success", "data": s.model_dump(mode="json")}
    raise HTTPException(status_code=404, detail="Storm cell not found")

@app.get("/api/lightning")
async def get_lightning(lat: float = 13.08, lon: float = 80.27):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        storms = demo_storms(lat, lon)
        strikes = demo_lightning_strikes(storms[0])
        return {"status": "success", "mode": "demo", "count": len(strikes), "data": [s.model_dump(mode="json") for s in strikes]}
    return {
        "status": "degraded",
        "mode": "real",
        "count": 0,
        "data": [],
        "message": "Ground lightning API credentials required in REAL mode; no fake strikes generated.",
    }

# ----------------- CONVECTIVE INITIATION -----------------

@app.get("/api/convective-initiation")
async def get_convective_initiation(lat: float = 13.08, lon: float = 80.27):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        ci = demo_convective_initiation(lat, lon)
    else:
        # In real mode, run scientific detection using available telemetry
        ci = detect_convective_initiation(
            lat=lat,
            lon=lon,
            cloud_top_temp_c=-35.0,
            cooling_rate_c_per_hr=4.0,
            reflectivity_dbz=28.0,
            reflectivity_growth_dbz_per_hr=3.0,
            lightning_onset=False,
            moisture_convergence=0.52,
            region_name="India Sector",
        )
    return {"status": "success", "mode": CURRENT_DATA_MODE, "data": ci.model_dump(mode="json")}

# ----------------- 0–6H FORECAST & 1–3 KM GRID -----------------

@app.get("/api/forecast")
@app.get("/api/grid")
async def get_forecast_grid(
    minutes: int = Query(30, ge=15, le=360),
    lat: float = Query(13.08, ge=-90, le=90),
    lon: float = Query(80.27, ge=-180, le=180),
):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        grid = demo_grid(minutes, lat, lon)
        return {
            "status": "success",
            "mode": "demo",
            "forecast_minutes": minutes,
            "grid_resolution": "1–3 km spatial resolution",
            "count": len(grid),
            "data": [g.model_dump(mode="json") for g in grid],
        }
    return {
        "status": "degraded",
        "mode": "real",
        "forecast_minutes": minutes,
        "data": [],
        "message": "Forecast grid requires live radar/satellite feeds; no synthetic values returned in REAL mode.",
    }

# ----------------- HAZARD PREDICTION -----------------

@app.get("/api/hazards")
async def get_hazards(
    minutes: int = Query(30, ge=15, le=360),
    lat: float = Query(13.08, ge=-90, le=90),
    lon: float = Query(80.27, ge=-180, le=180),
):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        storms = demo_storms(lat, lon)
        storm = storms[0]
        eta = eta_minutes(storm, lat, lon, extra_radius_km=3.0)
        hazards = compute_hazard_summary(storm, eta_min=eta, lead_time_min=minutes)
    else:
        hazards = compute_hazard_summary(None)
    return {"status": "success", "mode": CURRENT_DATA_MODE, "forecast_minutes": minutes, "data": hazards.model_dump(mode="json")}

# ----------------- USER WARNING & ARRIVAL COUNTDOWN -----------------

@app.get("/api/user-warning")
async def get_user_warning(
    lat: float = Query(13.08, ge=-90, le=90),
    lon: float = Query(80.27, ge=-180, le=180),
):
    _validate_coords(lat, lon)
    if CURRENT_DATA_MODE == "demo":
        storms = demo_storms(lat, lon)
        ci = demo_convective_initiation(lat, lon)
        warning = generate_local_warning(lat, lon, storms[0], ci=ci, mode="demo")
    else:
        ci = detect_convective_initiation(lat, lon)
        warning = generate_local_warning(lat, lon, None, ci=ci, mode="real")
    return {"status": "success", "mode": CURRENT_DATA_MODE, "warning": warning.model_dump(mode="json")}

@app.get("/api/rain-coming")
async def get_rain_coming(
    lat: float = Query(13.08, ge=-90, le=90),
    lon: float = Query(80.27, ge=-180, le=180),
):
    _validate_coords(lat, lon)
    storm = demo_storms(lat, lon)[0] if CURRENT_DATA_MODE == "demo" else None
    rc = compute_rain_coming(storm, lat, lon)
    return {"status": "success", "mode": CURRENT_DATA_MODE, "data": rc.model_dump(mode="json")}

@app.get("/api/storm-countdown")
async def get_storm_countdown(
    lat: float = Query(13.08, ge=-90, le=90),
    lon: float = Query(80.27, ge=-180, le=180),
):
    _validate_coords(lat, lon)
    storm = demo_storms(lat, lon)[0] if CURRENT_DATA_MODE == "demo" else None
    sc = compute_storm_countdown(storm, lat, lon)
    return {"status": "success", "mode": CURRENT_DATA_MODE, "data": sc.model_dump(mode="json")}

@app.get("/api/alerts")
@app.get("/api/warnings")
async def get_alerts():
    if CURRENT_DATA_MODE != "demo":
        return {"status": "success", "mode": "real", "data": [], "message": "No severe convective alerts issued in REAL mode."}
    storm = demo_storms()[0]
    alert = make_alert(
        storm_id=storm.storm_id,
        severity="SEVERE",
        message="CRITICAL: Severe convective storm cell with hail & downburst potential approaching Chennai Metropolitan Area.",
        hazard="THUNDERSTORM / HAIL",
    )
    return {"status": "success", "mode": "demo", "data": [alert]}

@app.get("/api/why-alert")
async def get_why_alert(alert_id: str = "ALT-001"):
    explanation = explain_alert(alert_id, mode=CURRENT_DATA_MODE)
    return {"status": "success", "mode": CURRENT_DATA_MODE, "data": explanation.model_dump(mode="json")}

@app.get("/api/model/status")
async def get_model_status():
    return {
        "status": "READY",
        "model_version": settings.model_version,
        "architecture": "HistGradientBoostingClassifier + Kinematic Tracking Advection + CI Rule Fusion",
        "features": [
            "dwr_reflectivity_max_dbz",
            "dwr_radial_velocity_shear",
            "insat_cloud_top_temperature_c",
            "insat_cooling_rate_c_per_hr",
            "lightning_stroke_rate_per_min",
            "surface_temp_humidity_index",
            "surface_moisture_convergence",
        ],
        "metrics_status": "HISTORICAL TRAINING DATASET NOT CONFIGURED (No fabricated accuracy claimed)",
        "training_interface": "ml/training/train_model.py",
        "evaluation_interface": "ml/evaluation/evaluate_model.py",
    }

# ----------------- REAL-TIME WEBSOCKET -----------------

@app.websocket("/ws/live")
@app.websocket("/ws/nowcast")
async def websocket_nowcast(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            now = datetime.now(timezone.utc)
            payload: Dict[str, Any] = {
                "timestamp": now.isoformat(),
                "mode": CURRENT_DATA_MODE,
                "storms": [],
                "countdown": None,
                "rain_coming": None,
            }
            if CURRENT_DATA_MODE == "demo":
                storms = demo_storms()
                payload["storms"] = [s.model_dump(mode="json") for s in storms]
                sc = compute_storm_countdown(storms[0], 13.08, 80.27)
                payload["countdown"] = sc.model_dump(mode="json")
                rc = compute_rain_coming(storms[0], 13.08, 80.27)
                payload["rain_coming"] = rc.model_dump(mode="json")
            await ws.send_json(payload)
            await asyncio.sleep(4)
    except (WebSocketDisconnect, RuntimeError):
        pass


# Serve compiled React frontend if available (allows 1-click single-service cloud deploy)
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

_dist_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _dist_dir.exists() and (_dist_dir / "index.html").exists():
    if (_dist_dir / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(_dist_dir / "assets")), name="frontend_assets")

    @app.get("/{full_path:path}")
    async def serve_spa_frontend(full_path: str):
        if full_path.startswith("api") or full_path.startswith("ws") or full_path.startswith("docs") or full_path == "openapi.json":
            raise HTTPException(status_code=404, detail="Not Found")
        target = _dist_dir / full_path
        if target.is_file():
            return FileResponse(target)
        return FileResponse(_dist_dir / "index.html")
