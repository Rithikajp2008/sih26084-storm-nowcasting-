from datetime import datetime, timezone
from ..core.schemas import Observation
from ..core.config import settings
RANGES={'temperature':(-60,60),'humidity':(0,100),'wind_speed':(0,250),'pressure':(850,1100),'rainfall':(0,2000),'rainfall_24h':(0,3000)}
def validate_observation(o:Observation):
    if not(settings.india_min_lat<=o.latitude<=settings.india_max_lat and settings.india_min_lon<=o.longitude<=settings.india_max_lon): return o.model_copy(update={'quality':'out_of_bounds'})
    if o.parameter in RANGES and not(RANGES[o.parameter][0]<=o.value<=RANGES[o.parameter][1]): return o.model_copy(update={'quality':'abnormal'})
    age=(datetime.now(timezone.utc)-o.timestamp).total_seconds()/60
    if age>settings.stale_after_minutes: return o.model_copy(update={'quality':'stale'})
    return o
