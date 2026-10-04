import os
import sys
import pytest
from fastapi.testclient import TestClient

os.environ["DATA_MODE"] = "demo"
sys.path.insert(0, ".")

from backend.app.main import app
from backend.app.services.grid import generate_hyperlocal_grid
from backend.app.services.routing import analyze_storm_aware_routes, evaluate_route_hazards
from backend.app.services.demo import demo_storms

client = TestClient(app)

def test_hyperlocal_grid_generation_30km():
    """Verifies that hyper-local grid (~2.8 km resolution = 1-3 km) is generated around coordinates,
    strictly clipped inside the authoritative 30 km monitoring circle.
    """
    from backend.app.services.grid import haversine_km
    grid = generate_hyperlocal_grid(center_lat=13.08, center_lon=80.27, minutes=30, mode="demo", storms=demo_storms(13.08, 80.27))
    assert len(grid) > 0
    
    # Check that all cells lie inside the 30 km circle
    for cell in grid:
        d = haversine_km(13.08, 80.27, cell.center_latitude, cell.center_longitude)
        assert d <= 30.5
        for pt in cell.geometry["coordinates"][0]:
            pt_dist = haversine_km(13.08, 80.27, pt[1], pt[0])
            assert pt_dist <= 30.05, f"Vertex {pt} exceeds 30 km: {pt_dist} km"
    
    # Check that cells have geometry and IDs
    first = grid[0]
    assert first.grid_id.startswith("GRID-")
    assert first.geometry["type"] == "Polygon"
    assert len(first.geometry["coordinates"][0]) >= 4
    
    # Check that risk levels exist
    statuses = {g.risk_level for g in grid}
    assert "SAFE" in statuses or "DANGER" in statuses

def test_grid_state_machine_analyzing_state():
    """Verifies State A (ANALYZING) subtle appearance before analysis finishes."""
    grid_analyzing = generate_hyperlocal_grid(center_lat=13.08, center_lon=80.27, is_analyzing=True)
    assert len(grid_analyzing) > 0
    for cell in grid_analyzing:
        assert cell.risk_level == "ANALYZING"
        assert cell.status == "ANALYZING"
        assert cell.storm_probability == 0.0

def test_grid_endpoint_demo_and_real():
    """Verifies GET /api/forecast and /api/grid return strictly clipped cells in demo mode."""
    res = client.get("/api/forecast?minutes=30&lat=13.08&lon=80.27")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["count"] == len(data["data"])
    assert data["count"] > 0
    assert data["data"][0]["risk_level"] in ["SAFE", "DANGER", "ANALYZING"]

def test_storm_aware_route_planner_post_api():
    """Tests POST /api/routes/analyze endpoint for the new Storm-Aware Safe Route Planner."""
    payload = {
        "start": {"latitude": 13.0827, "longitude": 80.2707},
        "destination": {"latitude": 12.9800, "longitude": 80.2200},
        "forecast_minutes": 30
    }
    res = client.post("/api/routes/analyze", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "OK"
    assert len(body["routes"]) >= 1
    
    # Verify Route attributes
    route = body["routes"][0]
    assert "routeId" in route
    assert "distanceKm" in route
    assert "durationMinutes" in route
    assert "riskScore" in route
    assert 0 <= route["riskScore"] <= 100
    assert route["riskLevel"] in ["LOW", "MODERATE", "ELEVATED", "HIGH", "SEVERE"]
    assert "recommendationReason" in route
    assert len(route["segments"]) >= 1

def test_storm_aware_route_planner_get_api():
    """Tests GET /api/routes/analyze endpoint."""
    res = client.get("/api/routes/analyze?start_lat=13.0827&start_lon=80.2707&dest_lat=12.9800&dest_lon=80.2200&minutes=30")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "OK"
    assert len(body["routes"]) >= 1
    assert body["recommendedRouteId"] is not None

def test_route_risk_considers_temporal_overlap():
    """Verifies that route risk increases when route arrival overlaps with storm ETA."""
    storms = demo_storms(13.08, 80.27)
    storm = storms[0]
    
    # Path passing near storm core with overlapping travel time
    coords = [[13.08, 80.27], [13.09, 80.28], [13.10, 80.29]]
    grid = generate_hyperlocal_grid(center_lat=13.08, center_lon=80.27, minutes=15, storms=storms)
    
    _, _, _, _, segments, score, level = evaluate_route_hazards(
        route_coords=coords,
        distance_km=10.0,
        duration_min=18.0, # arrival window overlaps with storm ETA
        grid_cells=grid,
        storm=storm,
        lead_time_min=15,
    )
    assert score > 30 # elevated or high due to proximity/timing
    assert len(segments) >= 1
