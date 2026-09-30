import math
from typing import Optional
from ..core.schemas import HazardSummary, HazardLevel, StormCell

def compute_hazard_summary(
    storm: Optional[StormCell],
    eta_min: Optional[float] = None,
    lead_time_min: int = 30
) -> HazardSummary:
    """Computes independent hazard predictions for the 5 SIH26084 hazards:
    1. Thunderstorm
    2. Lightning
    3. Hail
    4. Downburst / Severe Wind
    5. Cloudburst / Extreme Rainfall
    """
    if not storm:
        return HazardSummary(
            thunderstorm_probability=0.08,
            thunderstorm_severity="LOW",
            thunderstorm_eta_min=None,
            lightning_probability=0.05,
            lightning_strike_density_per_km2=0.0,
            lightning_trend="DECAYING",
            lightning_detected_strikes=0,
            hail_probability=0.02,
            hail_risk_level="LOW",
            hail_estimated_size_cm=0.0,
            hail_affected_radius_km=0.0,
            downburst_probability=0.04,
            downburst_max_gust_kmh=22.0,
            downburst_expected_range_kmh="15-25 km/h",
            downburst_direction_deg=45.0,
            cloudburst_probability=0.01,
            cloudburst_rate_mm_per_hr=0.0,
            cloudburst_accumulation_mm=0.0,
            cloudburst_risk_level="LOW",
            cloudburst_duration_minutes=0,
        )

    intensity = storm.intensity
    reflectivity = storm.reflectivity_max_dbz
    decay = math.exp(-max(0, lead_time_min) / 240.0)

    # A. Thunderstorm
    ts_prob = min(0.99, max(0.05, (intensity * 1.1) * decay))
    if ts_prob >= 0.75:
        ts_sev: HazardLevel = "SEVERE"
    elif ts_prob >= 0.50:
        ts_sev = "HIGH"
    elif ts_prob >= 0.25:
        ts_sev = "MODERATE"
    else:
        ts_sev = "LOW"

    # B. Lightning
    lt_prob = min(0.98, max(0.04, (intensity * 1.05 + 0.05) * decay))
    strike_density = round(max(0.0, (intensity * 3.8 - 0.5) * decay), 2)
    detected_strikes = int(max(0, round(strike_density * storm.area_km2 * 0.4)))
    trend = "RISING" if storm.growth_rate > storm.decay_rate else "DECAYING"

    # C. Hail (strongly linked to high dBZ core aloft > 50 dBZ)
    hail_raw = max(0.0, (reflectivity - 42.0) / 22.0 * intensity * decay)
    hail_prob = min(0.92, round(hail_raw, 2))
    if hail_prob >= 0.65:
        hail_level: HazardLevel = "SEVERE"
        hail_size = 3.5  # cm
    elif hail_prob >= 0.40:
        hail_level = "HIGH"
        hail_size = 2.0
    elif hail_prob >= 0.20:
        hail_level = "MODERATE"
        hail_size = 1.0
    else:
        hail_level = "LOW"
        hail_size = 0.5

    # D. Downburst / Severe Wind (reflectivity core collapse + cold pool acceleration)
    wind_raw = max(0.05, (intensity * 0.95 - 0.05) * decay)
    wind_prob = min(0.95, round(wind_raw, 2))
    max_gust = round(max(35.0, 35.0 + intensity * 62.0 * decay), 1)
    wind_range = f"{int(max_gust - 15)}-{int(max_gust)} km/h"

    # E. Cloudburst / Extreme Rainfall (rainfall rate > 100 mm/h or localized catastrophic deluge)
    cb_raw = max(0.0, (reflectivity - 48.0) / 18.0 * (intensity ** 1.3) * decay)
    cb_prob = min(0.90, round(cb_raw, 2))
    rain_rate = round(max(5.0, (reflectivity - 25.0) * 1.8 * intensity * decay), 1)
    accumulation = round(rain_rate * (45.0 / 60.0), 1)
    if cb_prob >= 0.60 or rain_rate >= 80.0:
        cb_risk: HazardLevel = "SEVERE"
    elif cb_prob >= 0.35 or rain_rate >= 45.0:
        cb_risk = "HIGH"
    elif cb_prob >= 0.15 or rain_rate >= 20.0:
        cb_risk = "MODERATE"
    else:
        cb_risk = "LOW"

    return HazardSummary(
        thunderstorm_probability=round(ts_prob, 2),
        thunderstorm_severity=ts_sev,
        thunderstorm_eta_min=eta_min,
        lightning_probability=round(lt_prob, 2),
        lightning_strike_density_per_km2=strike_density,
        lightning_trend=trend,
        lightning_detected_strikes=detected_strikes,
        hail_probability=hail_prob,
        hail_risk_level=hail_level,
        hail_estimated_size_cm=hail_size,
        hail_affected_radius_km=round(storm.radius_km * 0.65, 1),
        downburst_probability=wind_prob,
        downburst_max_gust_kmh=max_gust,
        downburst_expected_range_kmh=wind_range,
        downburst_direction_deg=storm.direction_deg,
        cloudburst_probability=cb_prob,
        cloudburst_rate_mm_per_hr=rain_rate,
        cloudburst_accumulation_mm=accumulation,
        cloudburst_risk_level=cb_risk,
        cloudburst_duration_minutes=45,
    )
