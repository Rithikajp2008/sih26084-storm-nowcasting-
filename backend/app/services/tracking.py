from datetime import datetime, timezone, timedelta
import math
from typing import List, Tuple
from ..core.schemas import StormCell, TrajectoryPoint
from .nowcast import project_point, storm_radius_km

COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

def get_compass_direction(deg: float) -> str:
    idx = int(((deg % 360.0) / 22.5) + 0.5) % 16
    return COMPASS_16[idx]

def compute_storm_trajectory(
    storm_id: str,
    lat: float,
    lon: float,
    speed_kmh: float,
    direction_deg: float,
    base_time: datetime,
    initial_radius_km: float = 7.0
) -> List[TrajectoryPoint]:
    """Generates 0-6 hour predicted trajectory waypoints (+15m, +30m, +1h, +2h, +3h, +6h)
    with expanding uncertainty radius.
    """
    intervals = [15, 30, 60, 120, 180, 360]
    points: List[TrajectoryPoint] = []
    
    for mins in intervals:
        dist_km = (speed_kmh * mins) / 60.0
        pt_lat, pt_lon = project_point(lat, lon, direction_deg, dist_km)
        arrival = base_time + timedelta(minutes=mins)
        # Uncertainty grows at approx 0.08 km per minute of lead time
        uncertainty = initial_radius_km + (mins * 0.07)
        points.append(TrajectoryPoint(
            minutes_ahead=mins,
            latitude=round(pt_lat, 4),
            longitude=round(pt_lon, 4),
            estimated_arrival=arrival,
            uncertainty_radius_km=round(uncertainty, 2)
        ))
        
    return points
