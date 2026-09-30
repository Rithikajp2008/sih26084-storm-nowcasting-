import time
from datetime import datetime, timezone
import httpx
from ..core.config import settings
from ..core.schemas import Observation, DataSourceHealth

class IMDAdapter:
    name = "IMD"
    def __init__(self): self.errors = 0
    async def _get(self, path, params=None):
        headers = {"Accept": "application/json"}
        if settings.imd_api_key: headers["Authorization"] = f"Bearer {settings.imd_api_key}"
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(settings.imd_api_url.rstrip("/") + path, params=params, headers=headers)
            r.raise_for_status(); return r.json()
    async def current_weather(self):
        data = await self._get("/api/v1/current_wx")
        rows = data.get("data", data if isinstance(data, list) else [])
        out=[]
        for row in rows:
            try:
                ts = datetime.now(timezone.utc)
                lat = float(row.get("Latitude") or row.get("latitude"))
                lon = float(row.get("Longitude") or row.get("longitude"))
            except (TypeError, ValueError): continue
            station = str(row.get("Station Id") or row.get("Station") or "unknown")
            for key,param,unit in [("Temperature","temperature","C"),("Humidity","humidity","%"),("Wind Speed","wind_speed","km/h"),("M.S.L.P","pressure","hPa"),("Last 24 hrs Rainfall","rainfall_24h","mm")]:
                try: out.append(Observation(timestamp=ts,latitude=lat,longitude=lon,source="IMD",parameter=param,value=float(row[key]),unit=unit,station_id=station))
                except (KeyError,TypeError,ValueError): pass
        return out
    async def aws_data(self):
        data = await self._get("/api/v1/aws_data")
        rows = data.get("data", data if isinstance(data,list) else [])
        out=[]
        for row in rows:
            try: lat=float(row.get("lat") or row.get("Latitude")); lon=float(row.get("lon") or row.get("Longitude"))
            except (TypeError,ValueError): continue
            station=str(row.get("Station") or row.get("station") or row.get("id") or "unknown")
            mapping=[("Temperature","temperature","C"),("Humidity","humidity","%"),("Wind Speed","wind_speed","km/h"),("Pressure","pressure","hPa"),("Rainfall","rainfall","mm")]
            for key,param,unit in mapping:
                if key in row:
                    try: out.append(Observation(timestamp=datetime.now(timezone.utc),latitude=lat,longitude=lon,source="IMD-AWS",parameter=param,value=float(row[key]),unit=unit,station_id=station))
                    except (TypeError,ValueError): pass
        return out
    async def nowcast(self): return await self._get("/api/v1/districtnowcast")
    async def health(self):
        t=time.perf_counter()
        try:
            await self._get("/api/v1/current_wx")
            return DataSourceHealth(name="IMD observations",status="LIVE",last_update=datetime.now(timezone.utc),latency_ms=(time.perf_counter()-t)*1000)
        except Exception as e:
            self.errors+=1
            return DataSourceHealth(name="IMD observations",status="ERROR",error_count=self.errors,message=str(e)[:180])

imd = IMDAdapter()
