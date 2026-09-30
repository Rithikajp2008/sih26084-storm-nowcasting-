from datetime import datetime, timezone
import time
import httpx
from ..core.config import settings
from ..core.schemas import DataSourceHealth

class LightningAdapter:
    async def health(self):
        if not settings.lightning_api_url:
            return DataSourceHealth(name="Lightning",status="NOT_CONNECTED",message="No legally accessible lightning API configured")
        t=time.perf_counter()
        try:
            headers={}
            if settings.lightning_api_key: headers["Authorization"]=f"Bearer {settings.lightning_api_key}"
            async with httpx.AsyncClient(timeout=15) as c:
                r=await c.get(settings.lightning_api_url,headers=headers); r.raise_for_status()
            return DataSourceHealth(name="Lightning",status="LIVE",last_update=datetime.now(timezone.utc),latency_ms=(time.perf_counter()-t)*1000)
        except Exception as e:
            return DataSourceHealth(name="Lightning",status="ERROR",message=str(e)[:180])
lightning=LightningAdapter()
