from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from ..core.schemas import ConvectiveInitiationSignal

def detect_convective_initiation(
    lat: float,
    lon: float,
    cloud_top_temp_c: float = -58.5,
    cooling_rate_c_per_hr: float = 14.2,
    reflectivity_dbz: float = 46.5,
    reflectivity_growth_dbz_per_hr: float = 18.0,
    lightning_onset: bool = True,
    moisture_convergence: float = 0.85,
    region_name: str = "Coastal Bay of Bengal / Chennai Sector"
) -> ConvectiveInitiationSignal:
    """Evaluates multi-source satellite IR, DWR radar, and lightning onset
    to detect rapid convective initiation (0-60 min before severe ground impact).

    Scientific criteria:
    1. Rapid cloud top cooling (dT/dt < -8 °C / hr, reaching < -40 °C)
    2. Radar reflectivity rapid core intensification (growth > 10 dBZ / hr, exceeding 35 dBZ)
    3. Lightning onset (first ground/IC strikes detected by network)
    4. Low-level moisture convergence index (> 0.65)
    """
    now = datetime.now(timezone.utc)
    signals: List[str] = []
    score = 0.0

    # 1. Cloud-top cooling (INSAT-3D/3DR TIR1/TIR2 10.8 µm band)
    if cloud_top_temp_c <= -50.0 and cooling_rate_c_per_hr >= 10.0:
        signals.append(f"Intense cloud-top cooling ({cloud_top_temp_c:.1f}°C at {cooling_rate_c_per_hr:.1f}°C/hr)")
        score += 0.35
    elif cloud_top_temp_c <= -38.0:
        signals.append(f"Moderate convective cloud-top growth ({cloud_top_temp_c:.1f}°C)")
        score += 0.20

    # 2. Radar reflectivity surge (DWR S-Band / C-Band)
    if reflectivity_dbz >= 45.0 and reflectivity_growth_dbz_per_hr >= 12.0:
        signals.append(f"Rapid DWR reflectivity surge ({reflectivity_dbz:.1f} dBZ, +{reflectivity_growth_dbz_per_hr:.1f} dBZ/hr)")
        score += 0.35
    elif reflectivity_dbz >= 35.0:
        signals.append(f"Elevated reflectivity core aloft ({reflectivity_dbz:.1f} dBZ)")
        score += 0.20

    # 3. Lightning onset
    if lightning_onset:
        signals.append("Lightning onset detected by ground lightning network")
        score += 0.20

    # 4. Low-level moisture convergence
    if moisture_convergence >= 0.70:
        signals.append(f"High surface moisture convergence index ({moisture_convergence:.2f})")
        score += 0.15

    confidence = min(0.96, max(0.10, score))
    detected = confidence >= 0.60

    if confidence >= 0.80:
        level = "RAPID_DEVELOPMENT"
    elif confidence >= 0.60:
        level = "EARLY_SIGNAL"
    elif confidence >= 0.40:
        level = "ACTIVE_CONVECTION"
    else:
        level = "NONE"

    return ConvectiveInitiationSignal(
        detected=detected,
        initiation_level=level,
        latitude=lat,
        longitude=lon,
        region_name=region_name,
        confidence=confidence,
        cloud_top_temp_c=cloud_top_temp_c,
        cooling_rate_c_per_hr=cooling_rate_c_per_hr,
        reflectivity_dbz=reflectivity_dbz,
        reflectivity_growth_dbz_per_hr=reflectivity_growth_dbz_per_hr,
        lightning_onset=lightning_onset,
        moisture_convergence_index=moisture_convergence,
        primary_signals=signals,
        timestamp=now,
    )
