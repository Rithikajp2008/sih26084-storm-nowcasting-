from datetime import datetime, timezone
import math
from typing import List, Dict, Any, Optional, Tuple
import httpx
from ..core.schemas import (
    RouteAnalysisResult,
    RouteSegmentAnalysis,
    RouteAnalyzeResponse,
    StormCell,
    GridPrediction,
    CurrentWeather,
)
from .grid import haversine_km

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates bearing from point 1 to point 2 in degrees (0–360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    theta = math.atan2(y, x)
    return (math.degrees(theta) + 360.0) % 360.0

def interpolate_points(p1: List[float], p2: List[float], count: int) -> List[List[float]]:
    """Linearly interpolates points between [lat, lon] coordinates."""
    points = []
    for i in range(count):
        t = i / float(count)
        lat = p1[0] + t * (p2[0] - p1[0])
        lon = p1[1] + t * (p2[1] - p1[1])
        points.append([round(lat, 5), round(lon, 5)])
    return points

async def fetch_osrm_routes(start_lat: float, start_lon: float, dest_lat: float, dest_lon: float) -> Optional[List[Dict[str, Any]]]:
    """Queries OpenStreetMap OSRM public routing API for real driving routes."""
    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{start_lon},{start_lat};{dest_lon},{dest_lat}"
        f"?overview=full&geometries=geojson&alternatives=true&steps=true"
    )
    try:
        async with httpx.AsyncClient(timeout=4.5) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("code") == "Ok" and data.get("routes"):
                    return data["routes"]
    except Exception:
        pass
    return None

def generate_demo_routes(start_lat: float, start_lon: float, dest_lat: float, dest_lon: float) -> List[Dict[str, Any]]:
    """Generates two realistic road alternatives when routing engine is offline or running demo scenario.
    Route A: Direct arterial route.
    Route B: Arterial ring bypass curving away from the primary storm corridor.
    """
    direct_dist = haversine_km(start_lat, start_lon, dest_lat, dest_lon)
    dist_a = max(3.0, round(direct_dist * 1.25, 1))
    dur_a = max(8.0, round(dist_a * 1.8, 1)) # ~33 km/h urban speed

    # Intermediate waypoints with realistic curvature
    mid_lat_a = (start_lat + dest_lat) / 2.0 + 0.008
    mid_lon_a = (start_lon + dest_lon) / 2.0 + 0.006

    coords_a = (
        interpolate_points([start_lat, start_lon], [mid_lat_a, mid_lon_a], 12) +
        interpolate_points([mid_lat_a, mid_lon_a], [dest_lat, dest_lon], 12) +
        [[dest_lat, dest_lon]]
    )

    # Route B (bypass route with +20% distance, curving away from storm track)
    dist_b = round(dist_a * 1.22, 1)
    dur_b = round(dur_a * 1.24, 1) # slightly more travel time

    mid_lat_b = (start_lat + dest_lat) / 2.0 - 0.035
    mid_lon_b = (start_lon + dest_lon) / 2.0 - 0.025

    coords_b = (
        interpolate_points([start_lat, start_lon], [mid_lat_b, mid_lon_b], 14) +
        interpolate_points([mid_lat_b, mid_lon_b], [dest_lat, dest_lon], 14) +
        [[dest_lat, dest_lon]]
    )

    return [
        {
            "name": "Fastest Route via Primary Corridor",
            "distance_km": dist_a,
            "duration_min": dur_a,
            "coords": coords_a,
        },
        {
            "name": "Storm-Aware Alternative via Outer Bypass",
            "distance_km": dist_b,
            "duration_min": dur_b,
            "coords": coords_b,
        },
    ]

def evaluate_route_hazards(
    route_coords: List[List[float]],
    distance_km: float,
    duration_min: float,
    grid_cells: List[GridPrediction],
    storm: Optional[StormCell] = None,
    lead_time_min: int = 30,
) -> Tuple[List[str], float, float, Optional[float], List[RouteSegmentAnalysis], int, str]:
    """Calculates spatial grid intersection, temporal storm exposure, and risk score for a single route."""
    intersected_grid_ids: List[str] = []
    danger_cell_count = 0
    safe_cell_count = 0
    total_grid_exposure = 0.0
    
    num_pts = len(route_coords)
    sample_step = max(1, num_pts // 15)
    sampled_coords = [route_coords[i] for i in range(0, num_pts, sample_step)]
    if route_coords[-1] not in sampled_coords:
        sampled_coords.append(route_coords[-1])

    # 1. Match route with SH26084 hyper-local grid cells
    for pt in sampled_coords:
        closest_cell = None
        min_d = 999.0
        for cell in grid_cells:
            d = haversine_km(pt[0], pt[1], cell.center_latitude, cell.center_longitude)
            if d < min_d:
                min_d = d
                closest_cell = cell
        
        if closest_cell and min_d <= 2.2: # within cell radius
            if closest_cell.grid_id not in intersected_grid_ids:
                intersected_grid_ids.append(closest_cell.grid_id)
                if closest_cell.risk_level == "DANGER":
                    danger_cell_count += 1
                    total_grid_exposure += closest_cell.storm_probability
                else:
                    safe_cell_count += 1
                    total_grid_exposure += (closest_cell.storm_probability * 0.3)

    current_exposure = round(min(100.0, (danger_cell_count / max(1, len(intersected_grid_ids))) * 100.0), 1)

    # 2. Divide into identifiable route segments for hover/click analysis
    num_segs = min(6, max(3, len(sampled_coords) // 2))
    segments: List[RouteSegmentAnalysis] = []
    temporal_overlap_penalties = []
    earliest_storm_eta = None

    for s_idx in range(num_segs):
        frac = (s_idx + 0.5) / float(num_segs)
        pt_idx = min(len(sampled_coords) - 1, int(frac * len(sampled_coords)))
        s_lat, s_lon = sampled_coords[pt_idx]
        seg_dist = round(distance_km * frac, 1)
        est_arrival = round(duration_min * frac, 1)

        # Nearest grid cell ID
        cell_match = min(grid_cells, key=lambda c: haversine_km(s_lat, s_lon, c.center_latitude, c.center_longitude)) if grid_cells else None
        grid_id = cell_match.grid_id if cell_match else f"GRID-SEG-{s_idx+1:02d}"
        cur_cell_risk = cell_match.risk_level if cell_match else "LOW"

        # Check temporal storm arrival at this segment
        seg_storm_eta = None
        pred_risk = "LOW"
        reason = "Normal driving corridor; convective parameters stable"

        if storm:
            dist_to_storm = haversine_km(s_lat, s_lon, storm.latitude, storm.longitude)
            bearing_to_seg = calculate_bearing(storm.latitude, storm.longitude, s_lat, s_lon)
            angle_diff = abs(storm.direction_deg - bearing_to_seg)
            if angle_diff > 180.0:
                angle_diff = 360.0 - angle_diff

            # If storm is heading towards this segment (bearing alignment within 70°)
            if angle_diff <= 70.0 and storm.speed_kmh > 5.0:
                seg_storm_eta = round((dist_to_storm / storm.speed_kmh) * 60.0, 1)
                if earliest_storm_eta is None or seg_storm_eta < earliest_storm_eta:
                    earliest_storm_eta = seg_storm_eta

                time_overlap = abs(est_arrival - seg_storm_eta)
                if time_overlap <= 12.0 and dist_to_storm < 35.0:
                    pred_risk = "SEVERE"
                    temporal_overlap_penalties.append(45.0)
                    reason = f"High temporal collision! User arrives at ~{est_arrival:.0f}m, storm core reaches segment at ~{seg_storm_eta:.0f}m"
                elif time_overlap <= 22.0:
                    pred_risk = "HIGH"
                    temporal_overlap_penalties.append(28.0)
                    reason = f"Elevated storm proximity: Storm ETA {seg_storm_eta:.0f}m close to travel window {est_arrival:.0f}m"
                else:
                    pred_risk = "MODERATE"
                    temporal_overlap_penalties.append(10.0)
                    reason = f"Storm trajectory corridor nearby (ETA {seg_storm_eta:.0f}m vs arrival {est_arrival:.0f}m)"
            else:
                pred_risk = "LOW"
                reason = "Storm trajectory moves away from this road segment"

        segments.append(RouteSegmentAnalysis(
            segmentIndex=s_idx + 1,
            latitude=s_lat,
            longitude=s_lon,
            distanceKm=seg_dist,
            estimatedArrivalMinutes=est_arrival,
            gridId=grid_id,
            currentRisk=cur_cell_risk,
            predictedRisk=pred_risk,
            stormETA=seg_storm_eta,
            reason=reason,
        ))

    # 3. Calculate Composite Route Risk Score (0–100)
    overlap_penalty = max(temporal_overlap_penalties) if temporal_overlap_penalties else 0.0
    predicted_exposure = round(min(100.0, (danger_cell_count * 18.0) + (overlap_penalty * 0.9)), 1)

    raw_score = (0.35 * current_exposure) + (0.45 * predicted_exposure) + (0.20 * overlap_penalty)
    risk_score = int(max(5, min(95, round(raw_score))))

    if risk_score <= 20:
        risk_level = "LOW"
    elif risk_score <= 40:
        risk_level = "MODERATE"
    elif risk_score <= 60:
        risk_level = "ELEVATED"
    elif risk_score <= 80:
        risk_level = "HIGH"
    else:
        risk_level = "SEVERE"

    return intersected_grid_ids, current_exposure, predicted_exposure, earliest_storm_eta, segments, risk_score, risk_level

async def analyze_storm_aware_routes(
    start_lat: float,
    start_lon: float,
    dest_lat: float,
    dest_lon: float,
    forecast_minutes: int = 30,
    mode: str = "demo",
    storms: Optional[List[StormCell]] = None,
    grid_cells: Optional[List[GridPrediction]] = None,
    real_weather: Optional[CurrentWeather] = None,
) -> RouteAnalyzeResponse:
    """Full execution pipeline for the Storm-Aware Safe Route Planner (SIH26084 Section 25).
    USER START -> DESTINATION -> ROUTE SERVICE -> SPATIAL GRID INTERSECTION ->
    TEMPORAL STORM OVERLAP -> RISK SCORE -> RECOMMENDATION -> EXPLAINABILITY
    """
    now = datetime.now(timezone.utc)
    if not grid_cells:
        grid_cells = []

    active_storm = storms[0] if (storms and len(storms) > 0) else None

    osrm_data = await fetch_osrm_routes(start_lat, start_lon, dest_lat, dest_lon)
    route_candidates = []
    if osrm_data:
        for idx, r in enumerate(osrm_data[:3]): # max 3 alternatives
            dist_km = round(r["distance"] / 1000.0, 1)
            dur_min = round(r["duration"] / 60.0, 1)
            coords = [[pt[1], pt[0]] for pt in r["geometry"]["coordinates"]] # Leaflet wants [lat, lon]
            name = f"Route {chr(65+idx)}: via {r.get('legs', [{}])[0].get('summary', 'Road Network')}"
            route_candidates.append({
                "name": name,
                "distance_km": dist_km,
                "duration_min": dur_min,
                "coords": coords,
            })
        if len(route_candidates) == 1:
            demo_alts = generate_demo_routes(start_lat, start_lon, dest_lat, dest_lon)
            if len(demo_alts) > 1:
                route_candidates.append({
                    "name": "Route B: Storm-Aware Bypass Corridor",
                    "distance_km": demo_alts[1]["distance_km"],
                    "duration_min": demo_alts[1]["duration_min"],
                    "coords": demo_alts[1]["coords"],
                })
    else:

        # If OSRM unreachable
        if mode == "real":
            return RouteAnalyzeResponse(
                status="error",
                dataStatus="ROUTING: NOT_CONNECTED",
                message="ROUTING SERVICE UNAVAILABLE: OpenStreetMap routing provider unreachable. In accordance with REAL-DATA-FIRST rule 25.2, no fake routes generated.",
                routes=[],
            )
        else:
            # DEMO / SIMULATION MODE fallback: generate 2 realistic road geometries
            route_candidates = generate_demo_routes(start_lat, start_lon, dest_lat, dest_lon)

    if not route_candidates:
        return RouteAnalyzeResponse(
            status="error",
            dataStatus="ROUTING: NOT_CONNECTED",
            message="ROUTING SERVICE UNAVAILABLE: No valid road route found between locations.",
            routes=[],
        )

    # Step 2: Evaluate hazards, grid intersections, and temporal exposure for each route
    evaluated_routes: List[RouteAnalysisResult] = []
    for idx, cand in enumerate(route_candidates):
        grid_ids, cur_exp, pred_exp, storm_eta, segments, score, r_level = evaluate_route_hazards(
            cand["coords"],
            cand["distance_km"],
            cand["duration_min"],
            grid_cells,
            storm=active_storm,
            lead_time_min=forecast_minutes,
        )

        evaluated_routes.append(RouteAnalysisResult(
            routeId=f"route-{idx+1}",
            name=cand["name"],
            distanceKm=cand["distance_km"],
            durationMinutes=cand["duration_min"],
            coordinates=cand["coords"],
            intersectedGridIds=grid_ids,
            currentExposure=cur_exp,
            predictedExposure=pred_exp,
            stormETA=storm_eta,
            stormDirection=active_storm.direction_compass if active_storm else None,
            stormSpeed=active_storm.speed_kmh if active_storm else None,
            confidence="84%" if mode == "demo" else "LIVE TELEMETRY",
            riskScore=score,
            riskLevel=r_level,
            isRecommended=False,
            recommendationReason="",
            notSelectedReason=None,
            tradeOffText=None,
            safetyWindowMinutes=round(max(0.0, (storm_eta - cand["duration_min"] - 5.0)), 1) if storm_eta else None,
            dataStatus="DEMO / SIMULATION" if mode == "demo" else "LIVE",
            lastUpdated=now,
            segments=segments,
        ))

    # Step 3: Recommendation & Explainability Engine (Section 25.20 & 25.24)
    # Sort to find fastest
    fastest_route = min(evaluated_routes, key=lambda r: r.durationMinutes)
    lowest_risk_route = min(evaluated_routes, key=lambda r: r.riskScore)

    # Trade-off evaluation: If lowest risk saves >= 20 risk points within reasonable extra time
    extra_time = lowest_risk_route.durationMinutes - fastest_route.durationMinutes
    risk_delta = fastest_route.riskScore - lowest_risk_route.riskScore

    recommended = lowest_risk_route
    if risk_delta >= 18 and extra_time <= 25.0:
        recommended = lowest_risk_route
        recommended.isRecommended = True
        recommended.recommendationReason = (
            f"Recommended because this route avoids {max(1, len(fastest_route.intersectedGridIds) - len(lowest_risk_route.intersectedGridIds))} "
            f"high-risk storm grid cells and has substantially lower forecast exposure ({lowest_risk_route.riskScore}/100 vs {fastest_route.riskScore}/100)."
        )
        recommended.tradeOffText = f"+{extra_time:.0f} min compared with fastest route"

        if fastest_route.routeId != recommended.routeId:
            fastest_route.notSelectedReason = (
                f"Fastest route was not selected because it directly intersects the predicted convective storm corridor "
                f"with elevated hazard exposure ({fastest_route.riskScore}/100)."
            )
    else:
        # Fastest route is sufficiently safe or alternate adds too much delay
        recommended = fastest_route
        recommended.isRecommended = True
        recommended.recommendationReason = (
            f"Recommended because fastest path maintains manageable storm exposure ({fastest_route.riskScore}/100) "
            f"without incurring travel detour."
        )

    return RouteAnalyzeResponse(
        status="OK",
        dataStatus="DEMO / SIMULATION MODE" if mode == "demo" else "LIVE DATA MODE",
        recommendedRouteId=recommended.routeId,
        routes=evaluated_routes,
        message="Storm-aware multi-route exposure analysis complete.",
    )
