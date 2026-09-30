import os
import sys
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

os.environ["DATA_MODE"] = "demo"
sys.path.insert(0, ".")

from backend.app.main import app
from backend.app.services.ci_detector import detect_convective_initiation
from backend.app.services.hazards import compute_hazard_summary
from backend.app.services.demo import demo_storms, demo_convective_initiation
from backend.app.services.nowcast import compute_rain_coming, compute_storm_countdown

client = TestClient(app)

def test_convective_initiation_detection():
    ci = detect_convective_initiation(
        lat=13.08,
        lon=80.27,
        cloud_top_temp_c=-62.0,
        cooling_rate_c_per_hr=15.0,
        reflectivity_dbz=52.0,
        reflectivity_growth_dbz_per_hr=16.0,
        lightning_onset=True,
        moisture_convergence=0.82,
    )
    assert ci.detected is True
    assert ci.initiation_level in ["RAPID_DEVELOPMENT", "EARLY_SIGNAL"]
    assert len(ci.primary_signals) >= 3
    assert ci.confidence >= 0.70

def test_hazard_summary_five_hazards():
    storms = demo_storms()
    hazards = compute_hazard_summary(storms[0], eta_min=18.0, lead_time_min=30)
    
    # 1. Thunderstorm
    assert hazards.thunderstorm_probability > 0.5
    assert hazards.thunderstorm_severity in ["HIGH", "SEVERE"]
    
    # 2. Lightning
    assert hazards.lightning_probability > 0.5
    assert hazards.lightning_strike_density_per_km2 > 0
    assert hazards.lightning_trend in ["RISING", "STEADY", "DECAYING"]
    
    # 3. Hail
    assert hazards.hail_probability >= 0.0
    assert hazards.hail_risk_level in ["LOW", "MODERATE", "HIGH", "SEVERE"]
    
    # 4. Downburst / Severe Wind
    assert hazards.downburst_probability > 0.5
    assert hazards.downburst_max_gust_kmh > 40.0
    assert "-" in hazards.downburst_expected_range_kmh
    
    # 5. Cloudburst / Extreme Rainfall
    assert hazards.cloudburst_rate_mm_per_hr > 10.0
    assert hazards.cloudburst_risk_level in ["LOW", "MODERATE", "HIGH", "SEVERE"]

def test_rain_coming_feature():
    storms = demo_storms()
    rc = compute_rain_coming(storms[0], lat=13.08, lon=80.27)
    assert rc.expected is True
    assert rc.probability_percent > 50
    assert rc.expected_intensity in ["Moderate", "Heavy", "Extreme / Cloudburst"]
    assert rc.outlook_15m > 0
    assert rc.outlook_30m > 0

def test_storm_arrival_countdown():
    storms = demo_storms()
    sc = compute_storm_countdown(storms[0], lat=13.08, lon=80.27)
    assert sc.active_storm_detected is True
    assert sc.countdown_str is not None
    assert sc.distance_km >= 0

def test_api_convective_initiation_endpoint():
    resp = client.get("/api/convective-initiation?lat=13.08&lon=80.27")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "initiation_level" in data
    assert "primary_signals" in data

def test_api_hazards_endpoint():
    resp = client.get("/api/hazards?minutes=30&lat=13.08&lon=80.27")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "thunderstorm_probability" in data
    assert "lightning_probability" in data
    assert "hail_probability" in data
    assert "downburst_probability" in data
    assert "cloudburst_probability" in data

def test_api_current_weather_endpoint():
    resp = client.get("/api/current-weather?lat=13.08&lon=80.27&city=Chennai")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "temperature" in data
    assert "humidity" in data
    assert "wind_speed" in data
    assert "pressure" in data
    assert "weather_condition" in data

def test_api_lightning_endpoint():
    resp = client.get("/api/lightning?lat=13.08&lon=80.27")
    assert resp.status_code == 200
    assert resp.json()["count"] > 0

def test_api_why_alert_explainability():
    resp = client.get("/api/why-alert?alert_id=ALT-001")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["primary_factors"]) >= 3
    assert "data_provenance" in data

def test_mode_toggle_endpoint():
    # Toggle to real
    resp = client.post("/api/mode/toggle")
    assert resp.status_code == 200
    assert resp.json()["data_mode"] == "real"
    
    # Toggle back to demo
    resp = client.post("/api/mode/toggle")
    assert resp.status_code == 200
    assert resp.json()["data_mode"] == "demo"
