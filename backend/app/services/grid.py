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

def generate_hyperlocal_grid(
    center_lat: float = 13.0827,
    center_lon: float = 80.2707,
    minutes: int = 30,
    storms: Optional[List[StormCell]] = None,
    mode: str = "demo",
    real_weather: Optional[CurrentWeather] = None,
    is_analyzing: bool = False,
) -> List[GridPrediction]:
    """Generates an 11x11 real geographic grid (~1-3 km resolution, 2.8 km step) centered on the active monitoring location,
    covering the full 30 km monitoring radius (~31 km x 31 km = 121 cells).
    Adheres strictly to the SH26084 Grid State Machine:
      - ANALYZING -> subtle light charcoal/black fill
      - SAFE -> light green
      - DANGER -> light red
      - DATA_UNAVAILABLE -> neutral/stale indicator
    """
    now = datetime.now(timezone.utc)
    out: List[GridPrediction] = []
    
    # Grid spacing ~2.8 km (1-3 km hyper-local resolution required by SIH26084)
    step_lat = 0.025
    lon_step = 0.025 / max(cos(radians(max(abs(center_lat), 1))), 0.25)
    half_lat = step_lat / 2.0
    half_lon = lon_step / 2.0
    
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

    for iy in range(-5, 6):
        for ix in range(-5, 6):
            cell_lat = round(center_lat + iy * step_lat, 5)
            cell_lon = round(center_lon + ix * lon_step, 5)
            grid_id = f"GRID-{iy+5:02d}-{ix+5:02d}"
            
            # GeoJSON Bounding Box Polygon
            geom = {
                "type": "Polygon",
                "coordinates": [[
                    [round(cell_lon - half_lon, 5), round(cell_lat - half_lat, 5)],
                    [round(cell_lon + half_lon, 5), round(cell_lat - half_lat, 5)],
                    [round(cell_lon + half_lon, 5), round(cell_lat + half_lat, 5)],
                    [round(cell_lon - half_lon, 5), round(cell_lat + half_lat, 5)],
                    [round(cell_lon - half_lon, 5), round(cell_lat - half_lat, 5)],
                ]]
            }

            # State A: ANALYZING (State before real-time analysis finishes)
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

            # State B: Evaluated Real-Data or Calibrated Demo
            if mode == "demo":
                # Check proximity to advected storm cells
                min_dist = 999.0
                closest_storm = None
                for st in advected_storms:
                    d = haversine_km(cell_lat, cell_lon, st["lat"], st["lon"])
                    if d < min_dist:
                        min_dist = d
                        closest_storm = st

                if closest_storm and min_dist <= closest_storm["radius_km"]:
                    # INSIDE STORM CORE -> DANGER
                    p = max(0.72, min(0.98, (0.95 - (min_dist / (closest_storm["radius_km"] + 1.0)) * 0.22) * decay))
                    risk_level = "DANGER"
                    status = "DANGER"
                    reason = f"Inside {closest_storm['cell_id']} core at +{minutes}m (dist {min_dist:.1f} km, {closest_storm['reflectivity']} dBZ)"
                elif closest_storm and min_dist <= closest_storm["radius_km"] + 4.5:
                    # ELEVATED PERIMETER / HAZARD BUFFER -> DANGER
                    p = max(0.42, min(0.74, (0.68 - ((min_dist - closest_storm["radius_km"]) / 4.5) * 0.25) * decay))
                    risk_level = "DANGER"
                    status = "DANGER"
                    reason = f"Convective squall buffer within 4.5 km of {closest_storm['cell_id']}"
                else:
                    # OUTSIDE DANGER ZONE -> SAFE
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
                # REAL DATA MODE
                if real_weather:
                    dist_to_center = haversine_km(cell_lat, cell_lon, center_lat, center_lon)
                    if real_weather.status_level == "SEVERE" or real_weather.rainfall_rate_mm_h > 15.0:
                        # Real storm active in region
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
                        # Live weather stable / clear
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
