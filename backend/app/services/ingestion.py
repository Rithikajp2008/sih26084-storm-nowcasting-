"""Near-real-time ingestion orchestration.
A production deployment can call this from APScheduler/Celery. Failures are isolated per source.
"""
from .qc import validate_observation
from ..adapters import imd
async def ingest_imd():
    try:
        observations=await imd.current_weather()
        return [validate_observation(o) for o in observations]
    except Exception as exc:
        return {'error':str(exc),'source':'IMD'}
