from datetime import datetime, timezone, timedelta
import math
from typing import Optional, List, Tuple
from ..core.schemas import GridPrediction, StormCell, RainComingOutlook, StormArrivalCountdown
from ..core.config import settings

EARTH_KM_PER_DEG_LAT = 111.0

def risk_label(p: Optional[float]) -> Optional[str]:
    if p is None:
        return None
    if p >= 0.75:
        return "SEVERE"
    if p >= 0.50:
        return "HIGH"
    if p >= 0.25:
        return "MODERATE"
    return "LOW"

def project_point(lat: float, lon: float, bearing_deg: float, distance_km: float) -> Tuple[float, float]:
    """Project a point using a local tangent-plane approximation."""
    theta = math.radians(bearing_deg % 360.0)
    north_km = distance_km * math.cos(theta)
    east_km = distance_km * math.sin(theta)
    out_lat = lat + north_km / EARTH_KM_PER_DEG_LAT
    lon_scale = EARTH_KM_PER_DEG_LAT * max(math.cos(math.radians(lat)), 0.15)
    out_lon = lon + east_km / lon_scale
    return out_lat, out_lon

def storm_radius_km(storm: StormCell) -> float:
    """Approximate storm footprint radius from reported cell area or configured radius."""
    if hasattr(storm, 'radius_km') and storm.radius_km > 0:
        return storm.radius_km
    if storm.area_km2 <= 0:
        return 5.0
    return math.sqrt(storm.area_km2 / math.pi)

def eta_minutes(storm: StormCell, lat: float, lon: float, extra_radius_km: float = 0.0) -> Optional[float]:
    """ETA until the moving storm footprint reaches a fixed user location."""
    user_north_km = (lat - storm.latitude) * EARTH_KM_PER_DEG_LAT
    lon_scale = EARTH_KM_PER_DEG_LAT * max(
        math.cos(math.radians((lat + storm.latitude) / 2.0)), 0.15
    )
    user_east_km = (lon - storm.longitude) * lon_scale

    radius_km = max(0.0, storm_radius_km(storm) + extra_radius_km)
    distance_sq = user_east_km**2 + user_north_km**2
    if distance_sq <= radius_km**2:
        return 0.0
    if storm.speed_kmh <= 1.0:
        return None

    theta = math.radians(storm.direction_deg % 360.0)
    vx = storm.speed_kmh * math.sin(theta)  # east km/h
    vy = storm.speed_kmh * math.cos(theta)  # north km/h

    a = vx*vx + vy*vy
    b = -2.0 * (user_east_km*vx + user_north_km*vy)
    c = distance_sq - radius_km*radius_km
    disc = b*b - 4.0*a*c
    tolerance = 1e-9 * max(b*b, 4.0*a*abs(c), 1.0)
    if disc < -tolerance:
        return None
    sqrt_disc = math.sqrt(max(disc, 0.0))
    roots = [(-b - sqrt_disc) / (2.0*a), (-b + sqrt_disc) / (2.0*a)]
    future = [t for t in roots if t >= 0.0]
    if not future:
        return None
    return min(future) * 60.0

def compute_rain_coming(storm: Optional[StormCell], lat: float, lon: float) -> RainComingOutlook:
    """Evaluates whether rain is coming to the selected location,
    arrival ETA, intensity, duration, and 0-6h probabilities.
    """
    if not storm:
        return RainComingOutlook(
            expected=False,
            probability_percent=10,
            arrival_minutes=None,
            expected_intensity="None",
            expected_duration_min="0 min",
            outlook_15m=10,
            outlook_30m=8,
            outlook_1h=5,
            outlook_3h=5,
            outlook_6h=5,
        )

    eta = eta_minutes(storm, lat, lon, extra_radius_km=3.0)
    
    # Distance in km
    d_lat = (lat - storm.latitude) * EARTH_KM_PER_DEG_LAT
    lon_s = EARTH_KM_PER_DEG_LAT * math.cos(math.radians(lat))
    d_lon = (lon - storm.longitude) * lon_s
    dist_km = math.hypot(d_lat, d_lon)

    if eta is not None and eta <= 90:
        expected = True
        prob = int(min(98, max(55, 92 - (eta * 0.35))))
        arr_min = int(round(eta))
        duration = "45–60 min" if storm.intensity > 0.7 else "25–35 min"
        intensity = "Extreme / Cloudburst" if storm.intensity > 0.85 else "Heavy" if storm.intensity > 0.65 else "Moderate"
    elif dist_km < 35:
        expected = True
        prob = int(min(75, max(30, 80 - dist_km * 1.2)))
        arr_min = int(dist_km / max(storm.speed_kmh, 15) * 60)
        duration = "20–30 min"
        intensity = "Moderate"
    else:
        expected = False
        prob = 15
        arr_min = None
        duration = "None"
        intensity = "None"

    # Multi-timestep outlook probabilities
    o15 = min(98, int(prob * (1.1 if arr_min and arr_min <= 15 else 0.8)))
    o30 = min(95, int(prob * (1.05 if arr_min and arr_min <= 30 else 0.85)))
    o1h = min(90, int(prob * 0.90))
    o3h = min(75, int(prob * 0.60))
    o6h = min(60, int(prob * 0.40))

    return RainComingOutlook(
        expected=expected,
        probability_percent=prob,
        arrival_minutes=arr_min,
        expected_intensity=intensity,
        expected_duration_min=duration,
        outlook_15m=o15,
        outlook_30m=o30,
        outlook_1h=o1h,
        outlook_3h=o3h,
        outlook_6h=o6h,
    )

def compute_storm_countdown(storm: Optional[StormCell], lat: float, lon: float) -> StormArrivalCountdown:
    """Calculates live countdown to storm arrival for the command center display."""
    if not storm:
        return StormArrivalCountdown(
            active_storm_detected=False,
            countdown_seconds=0,
            countdown_str="00:00:00",
            arrival_clock_time=None,
            distance_km=0.0,
            direction_compass="—",
            confidence_percent=0,
            storm_id=None,
        )

    eta = eta_minutes(storm, lat, lon, extra_radius_km=3.0)
    
    # Distance
    d_lat = (lat - storm.latitude) * EARTH_KM_PER_DEG_LAT
    lon_s = EARTH_KM_PER_DEG_LAT * math.cos(math.radians(lat))
    d_lon = (lon - storm.longitude) * lon_s
    dist_km = round(math.hypot(d_lat, d_lon), 1)

    # Compass approach direction
    bearing = math.degrees(math.atan2(d_lon, d_lat)) % 360.0
    from .tracking import get_compass_direction
    dir_compass = get_compass_direction(storm.direction_deg)

    if eta is not None and eta >= 0:
        total_sec = int(eta * 60)
        hh = total_sec // 3600
        mm = (total_sec % 3600) // 60
        ss = total_sec % 60
        countdown_str = f"{hh:02d}:{mm:02d}:{ss:02d}"
        arr_time = (datetime.now(timezone.utc) + timedelta(minutes=eta)).strftime("%I:%M %p UTC")
        conf = int(min(95, max(60, 90 - eta * 0.15)))
        return StormArrivalCountdown(
            active_storm_detected=True,
            countdown_seconds=total_sec,
            countdown_str=countdown_str,
            arrival_clock_time=arr_time,
            distance_km=dist_km,
            direction_compass=dir_compass,
            confidence_percent=conf,
            storm_id=storm.cell_id,
        )

    return StormArrivalCountdown(
        active_storm_detected=True,
        countdown_seconds=0,
        countdown_str="PATH DIVERGENT",
        arrival_clock_time="Path does not intersect",
        distance_km=dist_km,
        direction_compass=dir_compass,
        confidence_percent=70,
        storm_id=storm.cell_id,
    )
