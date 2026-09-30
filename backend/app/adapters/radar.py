from datetime import datetime, timezone
from ..core.config import settings
from ..core.schemas import DataSourceHealth
class IMDRadarAdapter:
    """Adapter contract for an authorized machine-readable DWR product.
    Parser implementation is intentionally format-dependent; no undocumented endpoint is guessed.
    """
    async def health(self):
        if not settings.imd_radar_url:
            return DataSourceHealth(name='IMD Doppler Radar',status='NOT_CONNECTED',message='Set IMD_RADAR_URL to an authorized machine-readable DWR feed/product')
        return DataSourceHealth(name='IMD Doppler Radar',status='NOT_CONNECTED',message='Feed configured; attach product-specific parser for the authorized format')
radar=IMDRadarAdapter()
