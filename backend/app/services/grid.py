from math import cos, radians
from datetime import datetime, timezone
from ..core.config import settings
from ..core.schemas import GridPrediction

def make_grid(lat_min=settings.india_min_lat,lat_max=settings.india_max_lat,lon_min=settings.india_min_lon,lon_max=settings.india_max_lon,step_deg:float=.027):
    """Approximate 3 km cell centers. Production deployments should use a projected CRS/grid index.
    The demo region is intentionally bounded; arbitrary India regions can be configured.
    """
    out=[]; i=0; lat=lat_min
    while lat<=lat_max:
        lon_step=step_deg/max(cos(radians(max(abs(lat),1))),0.25); lon=lon_min
        while lon<=lon_max:
            out.append((f"IND-{i:07d}",lat,lon)); i+=1; lon+=lon_step
        lat+=step_deg
    return out
