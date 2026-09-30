from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from ..core.config import settings
from ..core.schemas import UserWarning, HazardSummary, ConvectiveInitiationSignal, WhyThisAlert, HazardLevel, WeatherStatusLevel
from .hazards import compute_hazard_summary
from .nowcast import eta_minutes, risk_label

def should_alert(storm_probability: float, distance_km: float, confidence: str = 'HIGH') -> bool:
    confidence_ok = confidence in {'HIGH', 'MEDIUM', 'DEMO', 'DEMO / CALIBRATED'}
    return bool(storm_probability >= settings.alert_threshold and distance_km <= 35 and confidence_ok)

def make_alert(storm_id: str, severity: str, message: str, hazard: str = "THUNDERSTORM") -> Dict[str, Any]:
    return {
        'alert_id': f"ALT-{datetime.now(timezone.utc).strftime('%H%M%S')}-{storm_id}",
        'storm_id': storm_id,
        'hazard': hazard,
        'severity': severity,
        'message': message,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'valid_until': (datetime.now(timezone.utc) + timedelta(minutes=90)).isoformat(),
    }

def generate_local_warning(
    lat: float,
    lon: float,
    storm: Optional[Any],
    ci: Optional[ConvectiveInitiationSignal] = None,
    mode: str = "demo"
) -> UserWarning:
    """Generates localized early warning with 3 km radius buffer and operational recommendations."""
    now = datetime.now(timezone.utc)
    valid_until = now + timedelta(minutes=90)
    
    if not storm:
        return UserWarning(
            warning_id="WARN-NONE",
            latitude=lat,
            longitude=lon,
            radius_km=3.0,
            eta_minutes=None,
            eta_range_minutes=None,
            severity="LOW",
            status_level="STABLE",
            headline="No Active Severe Convective Cells within Impact Buffer",
            operational_attention="No emergency convective action required at this time.",
            risks={"lightning": "LOW", "heavy_rain": "LOW", "strong_wind": "LOW", "hail": "LOW"},
            hazard_summary=compute_hazard_summary(None),
            convective_initiation=ci,
            confidence="HIGH" if mode == "real" else "DEMO",
            data_provenance={
                "Radar": "Connected" if mode == "demo" else "Awaiting feed",
                "Satellite": "Connected" if mode == "demo" else "Awaiting feed",
                "Lightning": "Connected" if mode == "demo" else "Awaiting feed",
                "AWS": "Online",
            },
            generated_at=now,
            valid_until=valid_until,
            disclaimer="Experimental AI decision-support prototype; not a substitute for official IMD/MoES warnings.",
        )

    eta = eta_minutes(storm, lat, lon, extra_radius_km=3.0)
    hazards = compute_hazard_summary(storm, eta_min=eta, lead_time_min=int(eta) if eta else 30)

    if eta is None:
        severity: HazardLevel = "LOW"
        status: WeatherStatusLevel = "WATCH"
        headline = f"Convective Storm {storm.cell_id} Active in Region (Track Divergent)"
        action = "Monitor localized radar/satellite updates; cell path does not directly intersect 3 km radius."
    elif eta <= 25:
        severity = "SEVERE"
        status = "SEVERE"
        headline = f"CRITICAL: Severe Convective Storm & Hail/Downburst Imminent within {int(round(eta))} min"
        action = "Take immediate shelter. Disconnect outdoor operations, seek grounded structures away from open areas and metallic towers."
    elif eta <= 60:
        severity = "HIGH"
        status = "ALERT"
        headline = f"ALERT: High-Intensity Thunderstorm Cell Approaching (ETA ~{int(round(eta))} min)"
        action = "Prepare drainage systems, halt high-altitude crane activities, prepare lightning safety protocols."
    else:
        severity = "MODERATE"
        status = "WATCH"
        headline = f"WATCH: Convective Storm Approaching (ETA ~{int(round(eta))} min)"
        action = "Review operational weather briefing and track radar core progression."

    eta_range = (max(0.0, eta - 8.0), eta + 8.0) if eta is not None else None

    provenance = {
        "DWR Radar Reflectivity": "Online (DWR Chennai / S-Band)" if mode == "demo" else "IMD DWR Feed",
        "INSAT-3D/3DR Satellite TIR": "Online (MOSDAC NRT)" if mode == "demo" else "MOSDAC Adapter",
        "Lightning Detection Network": "Online (Ground Network)" if mode == "demo" else "Lightning API",
        "Surface AWS / ARG": "Online" if mode == "demo" else "IMD AWS / WMO",
        "Nowcast Model Version": "moes-ncmrwf-nowcast-v2.1",
    }

    return UserWarning(
        warning_id=f"WARN-{int(now.timestamp())}",
        latitude=lat,
        longitude=lon,
        radius_km=3.0,
        eta_minutes=round(eta, 1) if eta is not None else None,
        eta_range_minutes=(round(eta_range[0], 1), round(eta_range[1], 1)) if eta_range else None,
        severity=severity,
        status_level=status,
        headline=headline,
        operational_attention=action,
        risks={
            "lightning": hazards.lightning_trend if hazards.lightning_probability > 0.6 else "MODERATE",
            "heavy_rain": hazards.cloudburst_risk_level,
            "strong_wind": hazards.downburst_expected_range_kmh,
            "hail": hazards.hail_risk_level,
        },
        hazard_summary=hazards,
        convective_initiation=ci,
        confidence="HIGH" if mode == "real" else "DEMO / SIMULATED",
        data_provenance=provenance,
        generated_at=now,
        valid_until=valid_until,
        disclaimer="Experimental AI decision-support prototype; not a substitute for official IMD warnings.",
    )

def explain_alert(alert_id: str, mode: str = "demo") -> WhyThisAlert:
    """Generates explainability factors for a specific warning or alert."""
    return WhyThisAlert(
        alert_id=alert_id,
        severity="SEVERE",
        primary_factors=[
            {
                "factor": "Radar Reflectivity Core Surge",
                "weight_percent": 34,
                "observation": "DWR reflectivity exceeded 55 dBZ aloft with +18 dBZ/hr intensification",
                "instrument": "Doppler Weather Radar (DWR)"
            },
            {
                "factor": "Rapid Cloud-Top Cooling",
                "weight_percent": 28,
                "observation": "INSAT-3DR 10.8 µm TIR channel dropped to -64.5°C at 16.8°C/hr",
                "instrument": "Geostationary Satellite INSAT-3DR"
            },
            {
                "factor": "Ground Lightning Stroke Spikes",
                "weight_percent": 22,
                "observation": "Stroke density surged to 2.8 strikes/km² with negative polarity cloud-to-ground strikes",
                "instrument": "Ground Lightning Detection Sensor Network"
            },
            {
                "factor": "Surface Moisture Flux Convergence",
                "weight_percent": 16,
                "observation": "Surface Dew Point depression < 1.8°C with coastal convergence index 0.88",
                "instrument": "Automated Weather Stations (AWS)"
            },
        ],
        data_provenance={
            "Radar": "AVAILABLE (Calibrated S-Band)" if mode == "demo" else "Real feed / Not configured",
            "Satellite": "AVAILABLE (INSAT-3DR Imager)" if mode == "demo" else "MOSDAC Feed / Not configured",
            "Lightning": "AVAILABLE (Detection Network)" if mode == "demo" else "Lightning feed / Not configured",
            "AWS": "AVAILABLE (Surface Network)",
            "NWP Background": "AVAILABLE (NCMRWF Unified Model)",
        },
        model_version="moes-ncmrwf-nowcast-v2.1",
        recommended_actions=[
            "Issue priority disaster mitigation alert for municipal zones under track",
            "Alert airport ground staff of impending microburst / severe shear hazard",
            "Broadcast lightning safety warning for agricultural and construction workers",
            "Verify storm water drainage pumps in potential cloudburst catchment areas",
        ]
    )
