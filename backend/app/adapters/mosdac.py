from datetime import datetime, timezone
import time
import httpx
from ..core.config import settings
from ..core.schemas import DataSourceHealth

class MOSDACAdapter:
    name="MOSDAC"
    async def health(self):
        if not (settings.mosdac_username and settings.mosdac_password and settings.mosdac_dataset_id):
            return DataSourceHealth(name="MOSDAC / INSAT",status="NOT_CONNECTED",message="MOSDAC credentials and datasetId are not configured")
        if not settings.mosdac_api_url:
            return DataSourceHealth(name="MOSDAC / INSAT",status="NOT_CONNECTED",message="Configure MOSDAC_API_URL; use the official MOSDAC download client/API")
        t=time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r=await c.get(settings.mosdac_api_url)
                r.raise_for_status()
            return DataSourceHealth(name="MOSDAC / INSAT",status="LIVE",last_update=datetime.now(timezone.utc),latency_ms=(time.perf_counter()-t)*1000)
        except Exception as e:
            return DataSourceHealth(name="MOSDAC / INSAT",status="ERROR",message=str(e)[:180])

mosdac=MOSDACAdapter()
