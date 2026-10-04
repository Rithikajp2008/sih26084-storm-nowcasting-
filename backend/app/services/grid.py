from math import cos, radians, sin, atan2, sqrt
from datetime import datetime, timezone
from typing import List, Optional, Tuple, Dict, Any
from ..core.config import settings
from ..core.schemas import GridPrediction, StormCell, CurrentWeather

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two coordinates in kilometers."""
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2.0) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2.0) ** 2
    c = 2.0 * atan2(sqrt(a), sqrt(max(0.0, 1.0 - a)))
    return r * c

def project_coords(lat: float, lon: float, bearing_deg: float, distance_km: float) -> Tuple[float, float]:
    """Projects latitude and longitude forward along a bearing for a given distance in km."""
    r = 6371.0
    brng = radians(bearing_deg)
    d_r = distance_km / r
    lat1 = radians(lat)
    lon1 = radians(lon)
    
    lat2 = math_asin_safe(sin(lat1) * cos(d_r) + cos(lat1) * sin(d_r) * cos(brng))
    lon2 = lon1 + atan2(sin(brng) * sin(d_r) * cos(lat1), cos(d_r) - sin(lat1) * sin(lat2))
    return degrees(lat2), degrees(lon2)

def math_asin_safe(x: float) -> float:
    from math import asin
    return asin(max(-1.0, min(1.0, x)))

def degrees(x: float) -> float:
    from math import degrees as deg
    return deg(x)

def clip_vertex_to_circle(v_lat: float, v_lon: float, c_lat: float, c_lon: float, max_radius_km: float = 30.0) -> Tuple[float, float]:
    d = haversine_km(c_lat, c_lon, v_lat, v_lon)
    if d <= max_radius_km:
        return round(v_lon, 5), round(v_lat, 5)
    scale = max_radius_km / max(d, 0.001)
    cl_lat = c_lat + (v_lat - c_lat) * scale
    cl_lon = c_lon + (v_lon - c_lon) * scale
    return round(cl_lon, 5), round(cl_lat, 5)

def make_grid(lat_min=settings.india_min_lat, lat_max=settings.india_max_lat, lon_min=settings.india_min_lon, lon_max=settings.india_max_lon, step_deg: float = 0.027):
    """Approximate 3 km cell centers across India region."""
    out = []
    i = 0
    lat = lat_min
    while lat <= lat_max:
        lon_step = step_deg / max(cos(radians(max(abs(lat), 1))), 0.25)
        lon = lon_min
        while lon <= lon_max:
            out.append((f"IND-{i:07d}", lat, lon))
            i += 1
            lon += lon_step
        lat += step_deg
    return out

def clip_cell_polygon_to_circle(
    center_lat: float,
    center_lon: float,
    cell_min_lat: float,
    cell_max_lat: float,
    cell_min_lon: float,
    cell_max_lon: float,
    radius_km: float = 30.0,
) -> Optional[List[List[float]]]:
    """Geometrically clips an axis-aligned lat/lon bounding box to lie strictly
    inside the authoritative 30 km circular boundary (safe margin 29.95 km to prevent stroke leakage).
    Returns closed GeoJSON [lon, lat] coordinates, or None if the cell is completely outside.
    """
    clip_r = min(radius_km, 29.95)
    cos_lat = max(cos(radians(center_lat)), 0.20)
    
    # Convert cell bounds to local tangent plane in kilometers
    x1 = (cell_min_lon - center_lon) * 111.0 * cos_lat
    x2 = (cell_max_lon - center_lon) * 111.0 * cos_lat
    y1 = (cell_min_lat - center_lat) * 111.0
    y2 = (cell_max_lat - center_lat) * 111.0
    
    r_sq = clip_r * clip_r
    
    # Check if closest point in cell to circle center is outside circle
    xc = max(x1, min(0.0, x2))
    yc = max(y1, min(0.0, y2))
    if xc * xc + yc * yc >= r_sq:
        return None
        
    corners = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
    in_circle = [cx * cx + cy * cy <= r_sq + 1e-6 for cx, cy in corners]
    
    # If all 4 corners are inside, return full box
    if all(in_circle):
        coords = []
        for cx, cy in corners:
            lat = center_lat + cy / 111.0
            lon = center_lon + cx / (111.0 * cos_lat)
            # Safe geodesic clamp
            d_geo = haversine_km(center_lat, center_lon, lat, lon)
            if d_geo > clip_r:
                scale = clip_r / max(d_geo, 0.001)
                lat = center_lat + (lat - center_lat) * scale
                lon = center_lon + (lon - center_lon) * scale
            coords.append([round(lon, 5), round(lat, 5)])
        coords.append(coords[0])
        return coords

    # Otherwise, intersect the 4 rectangle edges with the circle
    poly = []
    edges = [(corners[i], corners[(i + 1) % 4]) for i in range(4)]
    
    for i, ((xa, ya), (xb, yb)) in enumerate(edges):
        dx = xb - xa
        dy = yb - ya
        A = dx * dx + dy * dy
        B = 2.0 * (xa * dx + ya * dy)
        C = xa * xa + ya * ya - r_sq
        
        if in_circle[i]:
            poly.append((xa, ya))
            
        disc = B * B - 4.0 * A * C
        if disc >= 0 and A > 1e-9:
            s = sqrt(disc)
            t1 = (-B - s) / (2.0 * A)
            t2 = (-B + s) / (2.0 * A)
            ts = [t for t in (t1, t2) if 1e-5 < t < 1.0 - 1e-5]
            ts.sort()
            for t in ts:
                poly.append((xa + t * dx, ya + t * dy))

    if len(poly) < 3:
        return None

    # Insert circular arc points between consecutive points that lie on the circle boundary
    out_poly = []
    n = len(poly)
    for i in range(n):
        p1 = poly[i]
        p2 = poly[(i + 1) % n]
        out_poly.append(p1)
        
        d1 = sqrt(p1[0] * p1[0] + p1[1] * p1[1])
        d2 = sqrt(p2[0] * p2[0] + p2[1] * p2[1])
        
        if abs(d1 - clip_r) < 0.12 and abs(d2 - clip_r) < 0.12:
            ang1 = atan2(p1[1], p1[0])
            ang2 = atan2(p2[1], p2[0])
            diff = (ang2 - ang1) % (2.0 * 3.141592653589793)
            if 0.05 < diff < 3.141592653589793:
                steps = max(2, int(diff / (3.141592653589793 / 18.0)))
                for s in range(1, steps):
                    theta = ang1 + diff * (s / steps)
                    out_poly.append((clip_r * cos(theta), clip_r * sin(theta)))

    # Convert back to lat/lon GeoJSON coordinates
    result_coords = []
    for cx, cy in out_poly:
        lat = center_lat + cy / 111.0
        lon = center_lon + cx / (111.0 * cos_lat)
        # Ensure geodesic distance is strictly <= clip_r (SH26084 Section 4 & 5)
        d_geo = haversine_km(center_lat, center_lon, lat, lon)
        if d_geo > clip_r:
            scale = clip_r / max(d_geo, 0.001)
            lat = center_lat + (lat - center_lat) * scale
            lon = center_lon + (lon - center_lon) * scale
        result_coords.append([round(lon, 5), round(lat, 5)])
        
    result_coords.append(result_coords[0]) # close polygon ring
    return result_coords

def generate_hyperlocal_grid(
    center_lat: float = 13.0827,
    center_lon: float = 80.2707,
    minutes: int = 30,
    storms: Optional[List[StormCell]] = None,
    mode: str = "demo",
    real_weather: Optional[CurrentWeather] = None,
    is_analyzing: bool = False,
    radius_km: float = 30.0,
    step_km: float = 3.0,
) -> List[GridPrediction]:
    """Generates an approximately 3 km x 3 km hyper-local geographic grid (~3.0 km step)
    strictly clipped to the authoritative 30 km monitoring circle centered at (center_lat, center_lon).
    No active cell visually or logically extends outside the 30 km circle (SH26084 Sections 1, 4, 5, 8, 22).
    
    Adheres strictly to the SH26084 Grid State Machine:
      - ANALYZING -> neutral blue/gray indication during telemetry processing
      - SAFE -> low risk / clear flow
      - DANGER -> convective core / squall perimeter / elevated hazard
      - DATA_UNAVAILABLE -> neutral / explicit stale/unavailable state
    """
    now = datetime.now(timezone.utc)
    out: List[GridPrediction] = []
    
    cos_lat = max(cos(radians(center_lat)), 0.20)
    step_lat = step_km / 111.0
    lon_step = step_km / (111.0 * cos_lat)
    half_lat = step_lat / 2.0
    half_lon = lon_step / 2.0
    
    # Search candidate range across the 30 km monitoring region
    max_steps = int(radius_km / step_km) + 2
    
    # Active storm advection at +minutes lead time
    advected_storms = []
    if storms and mode == "demo":
        for s in storms:
            travel_km = s.speed_kmh * max(minutes, 0) / 60.0
            adv_lat, adv_lon = project_coords(s.latitude, s.longitude, s.direction_deg, travel_km)
            advected_storms.append({
                "cell_id": s.cell_id,
                "lat": adv_lat,
                "lon": adv_lon,
                "radius_km": s.radius_km,
                "reflectivity": s.reflectivity_max_dbz,
                "speed": s.speed_kmh,
                "bearing": s.direction_deg,
            })

    decay = max(0.3, 1.0 - (minutes / 400.0))

    for iy in range(-max_steps, max_steps + 1):
        for ix in range(-max_steps, max_steps + 1):
            cell_lat = round(center_lat + iy * step_lat, 5)
            cell_lon = round(center_lon + ix * lon_step, 5)
            dist_to_center = haversine_km(center_lat, center_lon, cell_lat, cell_lon)
            
            # Authoritative 30 km monitoring circle constraint:
            # Candidate cell center must be within radius_km
            if dist_to_center > radius_km:
                continue
            
            # Geometrically clip cell to the exact authoritative 30.0 km circle
            min_lat = cell_lat - half_lat
            max_lat = cell_lat + half_lat
            min_lon = cell_lon - half_lon
            max_lon = cell_lon + half_lon
            
            clipped_coords = clip_cell_polygon_to_circle(
                center_lat=center_lat,
                center_lon=center_lon,
                cell_min_lat=min_lat,
                cell_max_lat=max_lat,
                cell_min_lon=min_lon,
                cell_max_lon=max_lon,
                radius_km=radius_km,
            )
            
            # Exclude any candidate cell that lies outside the 30 km circle
            if not clipped_coords:
                continue
                
            grid_id = f"GRID-R{iy + max_steps:02d}-C{ix + max_steps:02d}"
            
            geom = {
                "type": "Polygon",
                "coordinates": [clipped_coords],
            }

            # State A: ANALYZING
            if is_analyzing:
                out.append(GridPrediction(
                    grid_id=grid_id,
                    center_latitude=cell_lat,
                    center_longitude=cell_lon,
                    geometry=geom,
                    forecast_minutes=minutes,
                    storm_probability=0.0,
                    lightning_probability=0.0,
                    hail_probability=0.0,
                    heavy_rain_probability=0.0,
                    strong_wind_probability=0.0,
                    extreme_rain_probability=0.0,
                    cloudburst_risk=0.0,
                    risk_level="ANALYZING",
                    status="ANALYZING",
                    confidence="INGESTING",
                    model_version="moes-ncmrwf-nowcast-v2.1",
                    input_timestamp=now,
                    prediction_timestamp=now,
                    sources=["INGESTION_PIPELINE"],
                    reasons=["Real-time telemetry ingestion & nowcasting analysis in progress"],
                ))
                continue

            # State B: Evaluated Demo Scenario
            if mode == "demo":
                min_dist = 999.0
                closest_storm = None
                for st in advected_storms:
                    d = haversine_km(cell_lat, cell_lon, st["lat"], st["lon"])
                    if d < min_dist:
                        min_dist = d
                        closest_storm = st

                if closest_storm and min_dist <= closest_storm["radius_km"]:
                    p = max(0.72, min(0.98, (0.95 - (min_dist / (closest_storm["radius_km"] + 1.0)) * 0.22) * decay))
                    risk_level = "DANGER"
                    status = "DANGER"
                    reason = f"Inside {closest_storm['cell_id']} core at +{minutes}m (dist {min_dist:.1f} km, {closest_storm['reflectivity']} dBZ)"
                elif closest_storm and min_dist <= closest_storm["radius_km"] + 4.5:
                    p = max(0.42, min(0.74, (0.68 - ((min_dist - closest_storm["radius_km"]) / 4.5) * 0.25) * decay))
                    risk_level = "DANGER"
                    status = "DANGER"
                    reason = f"Convective squall buffer within 4.5 km of {closest_storm['cell_id']}"
                else:
                    p = max(0.02, min(0.20, (0.12 - min(min_dist / 120.0, 0.10)) * decay))
                    risk_level = "SAFE"
                    status = "SAFE"
                    reason = f"Outside active convective storm corridor (closest core: {min_dist:.1f} km)"

                ltg_p = min(0.99, max(0.01, p * 1.06))
                hail_p = max(0.0, min(0.88, (p - 0.25) * decay))
                rain_p = min(0.99, max(0.02, p * 1.08))
                wind_p = max(0.0, min(0.92, (p - 0.12) * decay))
                cb_p = max(0.0, min(0.85, (p - 0.35) * decay))

                out.append(GridPrediction(
                    grid_id=grid_id,
                    center_latitude=cell_lat,
                    center_longitude=cell_lon,
                    geometry=geom,
                    forecast_minutes=minutes,
                    storm_probability=round(p, 3),
                    lightning_probability=round(ltg_p, 3),
                    hail_probability=round(hail_p, 3),
                    heavy_rain_probability=round(rain_p, 3),
                    strong_wind_probability=round(wind_p, 3),
                    extreme_rain_probability=round(cb_p, 3),
                    cloudburst_risk=round(cb_p, 3),
                    risk_level=risk_level,
                    status=status,
                    confidence="CALIBRATED",
                    model_version="moes-ncmrwf-nowcast-v2.1",
                    input_timestamp=now,
                    prediction_timestamp=now,
                    sources=["DWR-REFLECTIVITY", "INSAT-3DR-IR", "LIGHTNING-NETWORK"],
                    reasons=[reason],
                ))

            else:
                # State C: Real Data Mode
                if real_weather:
                    if real_weather.status_level == "SEVERE" or real_weather.rainfall_rate_mm_h > 15.0:
                        risk_level = "DANGER"
                        status = "DANGER"
                        p = 0.82
                        reason = f"Live WMO/IMD telemetry confirms severe convective activity ({real_weather.weather_condition})"
                    elif real_weather.status_level == "ALERT" or real_weather.rainfall_rate_mm_h > 5.0:
                        risk_level = "DANGER"
                        status = "DANGER"
                        p = 0.65
                        reason = f"Significant precipitation reported: {real_weather.rainfall_rate_mm_h} mm/h"
                    else:
                        risk_level = "SAFE"
                        status = "SAFE"
                        p = 0.08
                        reason = f"Ground truth stable: {real_weather.weather_condition}, rain {real_weather.rainfall_rate_mm_h} mm/h"

                    out.append(GridPrediction(
                        grid_id=grid_id,
                        center_latitude=cell_lat,
                        center_longitude=cell_lon,
                        geometry=geom,
                        forecast_minutes=minutes,
                        storm_probability=p,
                        lightning_probability=round(p * 0.8, 3),
                        hail_probability=0.0 if p < 0.7 else 0.4,
                        heavy_rain_probability=round(p * 0.9, 3),
                        strong_wind_probability=round(p * 0.7, 3),
                        extreme_rain_probability=0.0,
                        cloudburst_risk=0.0,
                        risk_level=risk_level,
                        status=status,
                        confidence="LIVE_GROUND_TRUTH",
                        model_version="moes-ncmrwf-nowcast-v2.1",
                        input_timestamp=real_weather.observation_timestamp,
                        prediction_timestamp=now,
                        sources=[real_weather.source],
                        reasons=[reason],
                    ))
                else:
                    # Telemetry not available
                    out.append(GridPrediction(
                        grid_id=grid_id,
                        center_latitude=cell_lat,
                        center_longitude=cell_lon,
                        geometry=geom,
                        forecast_minutes=minutes,
                        storm_probability=0.0,
                        lightning_probability=0.0,
                        hail_probability=0.0,
                        heavy_rain_probability=0.0,
                        strong_wind_probability=0.0,
                        extreme_rain_probability=0.0,
                        cloudburst_risk=0.0,
                        risk_level="DATA_UNAVAILABLE",
                        status="DATA_UNAVAILABLE",
                        confidence="UNAVAILABLE",
                        model_version="moes-ncmrwf-nowcast-v2.1",
                        input_timestamp=now,
                        prediction_timestamp=now,
                        sources=["RADAR_UNAVAILABLE"],
                        reasons=["Live Doppler radar / satellite telemetry unavailable for region"],
                    ))

    return out
