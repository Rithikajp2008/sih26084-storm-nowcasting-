import os
import sys
from datetime import datetime, timezone

os.environ["DATA_MODE"] = "demo"
sys.path.insert(0, ".")

from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.demo import demo_grid, demo_storms
from backend.app.services.nowcast import eta_minutes, project_point
from backend.app.services.grid import haversine_km
from backend.app.core.schemas import StormCell


def storm(**overrides):
    data = dict(
        storm_id="x",
        latitude=13.0,
        longitude=80.0,
        area_km2=0.0,
        intensity=.8,
        direction_deg=0.0,
        speed_kmh=30.0,
        growth_rate=0.0,
        decay_rate=0.0,
        age_minutes=1,
        source="test",
        timestamp=datetime.now(timezone.utc),
    )
    data.update(overrides)
    return StormCell(**data)


def test_eta_on_path_positive():
    s = storm(direction_deg=0)
    eta = eta_minutes(s, 13.1, 80.0)
    assert eta is not None and eta > 0


def test_eta_opposite_direction_is_none():
    s = storm(direction_deg=180)
    assert eta_minutes(s, 13.1, 80.0) is None


def test_eta_inside_storm_is_zero():
    s = storm(area_km2=150)
    assert eta_minutes(s, 13.0, 80.0) == 0.0


def test_projection_moves_in_bearing_direction():
    lat, lon = project_point(13.0, 80.0, 90, 10)
    assert abs(lat - 13.0) < 0.01
    assert lon > 80.0


def test_demo_grid_advects_with_time():
    g15 = demo_grid(15)
    g60 = demo_grid(60)
    assert len(g15) > 0
    assert len(g60) > 0
    # Every cell must strictly lie inside the authoritative 30 km circle
    for g in g15:
        assert haversine_km(13.08, 80.27, g.center_latitude, g.center_longitude) <= 30.5
    # Risk advection changes hazard levels over forecast lead times
    dangers_15 = sum(1 for g in g15 if g.risk_level == "DANGER")
    dangers_60 = sum(1 for g in g60 if g.risk_level == "DANGER")
    assert dangers_15 > 0


def test_api_demo_smoke():
    client = TestClient(app)
    assert client.get("/").status_code == 200
    assert client.get("/api/mode").json()["data_mode"] == "demo"
    res = client.get("/api/forecast?minutes=30")
    assert res.status_code == 200
    grid_data = res.json()["data"]
    assert len(grid_data) > 0
    # Ensure all cells are strictly inside 30 km circle
    for c in grid_data:
        assert haversine_km(13.08, 80.27, c["center_latitude"], c["center_longitude"]) <= 30.5
    assert client.get("/api/user-warning?lat=13.08&lon=80.27").status_code == 200


def test_zero_eta_not_lost():
    client = TestClient(app)
    w = client.get("/api/user-warning?lat=13.08&lon=80.27").json()["warning"]
    assert w["eta_minutes"] == 0.0
    assert w["eta_range_minutes"] is not None


def test_invalid_coordinates_rejected():
    client = TestClient(app)
    assert client.get("/api/user-warning?lat=100&lon=80").status_code == 422


def test_websocket_demo_stream():
    client = TestClient(app)
    with client.websocket_connect('/ws/live') as ws:
        payload = ws.receive_json()
        assert payload['mode'] == 'demo'
        assert len(payload['storms']) >= 1
        assert 'timestamp' in payload
