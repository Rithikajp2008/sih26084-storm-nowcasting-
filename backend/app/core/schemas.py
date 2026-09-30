from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, Literal, Any, Dict, List, Tuple

Status = Literal["LIVE", "STALE", "NOT_CONNECTED", "ERROR", "DEMO"]
HazardLevel = Literal["LOW", "MODERATE", "HIGH", "SEVERE"]
WeatherStatusLevel = Literal["STABLE", "WATCH", "ALERT", "SEVERE"]

class DataSourceHealth(BaseModel):
    name: str
    status: Status
    last_update: Optional[datetime] = None
    latency_ms: Optional[float] = None
    error_count: int = 0
    message: Optional[str] = None
    source_type: Optional[str] = None  # radar, satellite, lightning, aws, nwp, ml

class Observation(BaseModel):
    timestamp: datetime
    latitude: float
    longitude: float
    source: str
    parameter: str
    value: float
    unit: str
    quality: str = "good"
    station_id: Optional[str] = None

class TrajectoryPoint(BaseModel):
    minutes_ahead: int
    latitude: float
    longitude: float
    estimated_arrival: datetime
    uncertainty_radius_km: float

class StormCell(BaseModel):
    storm_id: str = "CELL-001"
    cell_id: str = "CELL-001"
    latitude: float
    longitude: float
    area_km2: float
    radius_km: float = 7.0
    intensity: float  # 0.0 to 1.0 normalized
    reflectivity_max_dbz: float = 48.0
    direction_deg: float
    direction_compass: str = "NE"
    speed_kmh: float
    growth_rate: float = 0.0
    decay_rate: float = 0.0
    age_minutes: int = 10
    severity: HazardLevel = "HIGH"
    trajectory: List[TrajectoryPoint] = Field(default_factory=list)
    source: str = "DWR-FUSION"
    timestamp: datetime

    def model_post_init(self, __context: Any) -> None:
        if self.cell_id == "CELL-001" and self.storm_id != "CELL-001":
            self.cell_id = self.storm_id
        elif self.storm_id == "CELL-001" and self.cell_id != "CELL-001":
            self.storm_id = self.cell_id


class LightningStrike(BaseModel):
    strike_id: str
    latitude: float
    longitude: float
    timestamp: datetime
    peak_current_ka: float = 24.5
    polarity: Literal["POSITIVE", "NEGATIVE"] = "NEGATIVE"
    age_seconds: int = 0

class ConvectiveInitiationSignal(BaseModel):
    detected: bool
    initiation_level: Literal["NONE", "EARLY_SIGNAL", "RAPID_DEVELOPMENT", "ACTIVE_CONVECTION"]
    latitude: float
    longitude: float
    region_name: str
    confidence: float
    cloud_top_temp_c: float
    cooling_rate_c_per_hr: float
    reflectivity_dbz: float
    reflectivity_growth_dbz_per_hr: float
    lightning_onset: bool
    moisture_convergence_index: float
    primary_signals: List[str]
    timestamp: datetime

class HazardSummary(BaseModel):
    thunderstorm_probability: float
    thunderstorm_severity: HazardLevel
    thunderstorm_eta_min: Optional[float]

    lightning_probability: float
    lightning_strike_density_per_km2: float
    lightning_trend: Literal["RISING", "STEADY", "DECAYING"]
    lightning_detected_strikes: int

    hail_probability: float
    hail_risk_level: HazardLevel
    hail_estimated_size_cm: float
    hail_affected_radius_km: float

    downburst_probability: float
    downburst_max_gust_kmh: float
    downburst_expected_range_kmh: str
    downburst_direction_deg: float

    cloudburst_probability: float
    cloudburst_rate_mm_per_hr: float
    cloudburst_accumulation_mm: float
    cloudburst_risk_level: HazardLevel
    cloudburst_duration_minutes: int

class CurrentWeather(BaseModel):
    temperature: float
    feels_like: Optional[float] = None
    humidity: float
    wind_speed: float
    wind_direction_deg: float
    wind_direction_compass: str = "ENE"
    pressure: float
    rainfall_rate_mm_h: float
    visibility_km: Optional[float] = 10.0
    cloud_cover_percent: Optional[float] = 75.0
    weather_condition: str
    status_level: WeatherStatusLevel
    status_reason: str
    observation_timestamp: datetime
    source: str
    city_name: Optional[str] = "Chennai"

class RainComingOutlook(BaseModel):
    expected: bool
    probability_percent: int
    arrival_minutes: Optional[int]
    expected_intensity: Literal["None", "Light", "Moderate", "Heavy", "Extreme / Cloudburst"]
    expected_duration_min: str
    outlook_15m: int
    outlook_30m: int
    outlook_1h: int
    outlook_3h: int
    outlook_6h: int

class StormArrivalCountdown(BaseModel):
    active_storm_detected: bool
    countdown_seconds: int
    countdown_str: str  # HH:MM:SS
    arrival_clock_time: Optional[str]
    distance_km: float
    direction_compass: str
    confidence_percent: int
    storm_id: Optional[str] = None

class GridPrediction(BaseModel):
    grid_id: str
    center_latitude: float
    center_longitude: float
    geometry: Dict[str, Any]
    forecast_minutes: int
    storm_probability: float
    lightning_probability: float
    hail_probability: float
    heavy_rain_probability: float
    strong_wind_probability: float
    extreme_rain_probability: float
    cloudburst_risk: float = 0.0
    confidence: str
    model_version: str
    input_timestamp: datetime
    prediction_timestamp: datetime
    sources: List[str] = Field(default_factory=list)
    reasons: List[str] = Field(default_factory=list)

class UserWarning(BaseModel):
    warning_id: str = "WARN-001"
    latitude: float
    longitude: float
    radius_km: float = 3.0
    eta_minutes: Optional[float] = None
    eta_range_minutes: Optional[Tuple[float, float]] = None
    severity: HazardLevel = "LOW"
    status_level: WeatherStatusLevel = "STABLE"
    headline: str = "Normal Conditions"
    operational_attention: str = "Standard monitoring"
    risks: Dict[str, str]
    hazard_summary: Optional[HazardSummary] = None
    convective_initiation: Optional[ConvectiveInitiationSignal] = None
    confidence: str = "HIGH"
    data_provenance: Dict[str, str] = Field(default_factory=dict)
    generated_at: datetime
    valid_until: datetime
    disclaimer: str

class WhyThisAlert(BaseModel):
    alert_id: str
    severity: str
    primary_factors: List[Dict[str, Any]]
    data_provenance: Dict[str, str]
    model_version: str
    recommended_actions: List[str]
