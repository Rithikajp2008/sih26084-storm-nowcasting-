export type Mode = 'real' | 'demo';

export interface DataSourceHealth {
  name: string;
  status: 'LIVE' | 'STALE' | 'NOT_CONNECTED' | 'ERROR' | 'DEMO';
  last_update?: string;
  latency_ms?: number;
  error_count?: number;
  message?: string;
  source_type?: string;
}

export interface TrajectoryPoint {
  minutes_ahead: number;
  latitude: number;
  longitude: number;
  estimated_arrival: string;
  uncertainty_radius_km: number;
}

export interface StormCell {
  storm_id: string;
  cell_id: string;
  latitude: number;
  longitude: number;
  area_km2: number;
  radius_km: number;
  intensity: number;
  reflectivity_max_dbz: number;
  direction_deg: number;
  direction_compass: string;
  speed_kmh: number;
  growth_rate: number;
  decay_rate: number;
  trend?: 'INTENSIFYING' | 'STABLE' | 'WEAKENING';
  age_minutes: number;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  trajectory: TrajectoryPoint[];
  source: string;
  timestamp: string;
}

export interface LightningStrike {
  strike_id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  peak_current_ka: number;
  polarity: 'POSITIVE' | 'NEGATIVE';
  age_seconds: number;
}

export interface ConvectiveInitiationSignal {
  detected: boolean;
  initiation_level: 'NONE' | 'EARLY_SIGNAL' | 'RAPID_DEVELOPMENT' | 'ACTIVE_CONVECTION';
  latitude: number;
  longitude: number;
  region_name: string;
  confidence: number;
  cloud_top_temp_c: number;
  cooling_rate_c_per_hr: number;
  reflectivity_dbz: number;
  reflectivity_growth_dbz_per_hr: number;
  lightning_onset: boolean;
  moisture_convergence_index: number;
  primary_signals: string[];
  timestamp: string;
}

export interface HazardSummary {
  thunderstorm_probability: number;
  thunderstorm_severity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  thunderstorm_eta_min?: number | null;

  lightning_probability: number;
  lightning_strike_density_per_km2: number;
  lightning_trend: 'RISING' | 'STEADY' | 'DECAYING';
  lightning_detected_strikes: number;

  hail_probability: number;
  hail_risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  hail_estimated_size_cm: number;
  hail_affected_radius_km: number;

  downburst_probability: number;
  downburst_max_gust_kmh: number;
  downburst_expected_range_kmh: string;
  downburst_direction_deg: number;

  cloudburst_probability: number;
  cloudburst_rate_mm_per_hr: number;
  cloudburst_accumulation_mm: number;
  cloudburst_risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  cloudburst_duration_minutes: number;
}

export interface CurrentWeather {
  temperature: number;
  feels_like?: number;
  humidity: number;
  wind_speed: number;
  wind_direction_deg: number;
  wind_direction_compass: string;
  pressure: number;
  rainfall_rate_mm_h: number;
  visibility_km?: number;
  cloud_cover_percent?: number;
  weather_condition: string;
  status_level: 'STABLE' | 'WATCH' | 'ALERT' | 'SEVERE';
  status_reason: string;
  observation_timestamp: string;
  source: string;
  city_name?: string;
}

export interface RainComingOutlook {
  expected: boolean;
  probability_percent: number;
  arrival_minutes?: number | null;
  expected_intensity: 'None' | 'Light' | 'Moderate' | 'Heavy' | 'Extreme / Cloudburst';
  expected_duration_min: string;
  outlook_15m: number;
  outlook_30m: number;
  outlook_1h: number;
  outlook_3h: number;
  outlook_6h: number;
}

export interface StormArrivalCountdown {
  active_storm_detected: boolean;
  countdown_seconds: number;
  countdown_str: string;
  arrival_clock_time?: string | null;
  distance_km: number;
  direction_compass: string;
  confidence_percent: number;
  storm_id?: string | null;
}

export interface GridPrediction {
  grid_id: string;
  center_latitude: number;
  center_longitude: number;
  geometry: {
    type: string;
    coordinates: number[][][];
  };
  forecast_minutes: number;
  storm_probability: number;
  lightning_probability: number;
  hail_probability: number;
  heavy_rain_probability: number;
  strong_wind_probability: number;
  extreme_rain_probability: number;
  cloudburst_risk: number;
  confidence: string;
  model_version: string;
  input_timestamp: string;
  prediction_timestamp: string;
  sources: string[];
  reasons: string[];
}

export interface UserWarning {
  warning_id: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  eta_minutes?: number | null;
  eta_range_minutes?: [number, number] | null;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  status_level: 'STABLE' | 'WATCH' | 'ALERT' | 'SEVERE';
  headline: string;
  operational_attention: string;
  what_hazard?: string;
  why_reason?: string;
  when_expected?: string;
  risks: {
    lightning: string;
    heavy_rain: string;
    strong_wind: string;
    hail?: string;
  };
  hazard_summary?: HazardSummary;
  convective_initiation?: ConvectiveInitiationSignal;
  confidence: string;
  data_provenance: Record<string, string>;
  generated_at: string;
  valid_until: string;
  disclaimer: string;
}

export interface WhyThisAlert {
  alert_id: string;
  severity: string;
  primary_factors: Array<{
    factor: string;
    weight_percent: number;
    observation: string;
    instrument: string;
  }>;
  data_provenance: Record<string, string>;
  model_version: string;
  recommended_actions: string[];
}
