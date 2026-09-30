-- ============================================================================
-- SIH26084: Convective Storm Nowcasting Database Schema (PostgreSQL + PostGIS)
-- Ministry of Earth Sciences (MoES) / NCMRWF
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Weather Stations
CREATE TABLE IF NOT EXISTS weather_stations (
    station_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(128),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    elevation_m DOUBLE PRECISION,
    geom GEOMETRY(Point, 4326),
    station_type VARCHAR(64) DEFAULT 'AWS',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Weather Observations (Surface AWS / ARG)
CREATE TABLE IF NOT EXISTS weather_observations (
    id BIGSERIAL PRIMARY KEY,
    station_id VARCHAR(64) REFERENCES weather_stations(station_id),
    timestamp TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326),
    source VARCHAR(64) NOT NULL,
    parameter VARCHAR(64) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(32) NOT NULL,
    quality VARCHAR(32) DEFAULT 'good',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Radar Observations (Doppler Weather Radar - DWR)
CREATE TABLE IF NOT EXISTS radar_observations (
    id BIGSERIAL PRIMARY KEY,
    station_name VARCHAR(64) NOT NULL,
    scan_timestamp TIMESTAMPTZ NOT NULL,
    product_type VARCHAR(32) NOT NULL, -- e.g. PPI, CAPPI, MAX_Z, VIL
    max_reflectivity_dbz DOUBLE PRECISION,
    echo_top_km DOUBLE PRECISION,
    radial_velocity_max DOUBLE PRECISION,
    raw_file_uri TEXT,
    quality_flag VARCHAR(32) DEFAULT 'good',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Satellite Observations (INSAT-3D / 3DR)
CREATE TABLE IF NOT EXISTS satellite_observations (
    id BIGSERIAL PRIMARY KEY,
    satellite_name VARCHAR(64) NOT NULL, -- INSAT-3D / INSAT-3DR
    scan_timestamp TIMESTAMPTZ NOT NULL,
    channel VARCHAR(32) NOT NULL, -- TIR1, TIR2, MIR, VIS
    min_cloud_top_temp_c DOUBLE PRECISION,
    cloud_top_cooling_rate_c_hr DOUBLE PRECISION,
    he_rain_rate_max_mm_h DOUBLE PRECISION,
    raw_hdf_uri TEXT,
    quality_flag VARCHAR(32) DEFAULT 'good',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Lightning Observations (Ground Detection Network)
CREATE TABLE IF NOT EXISTS lightning_observations (
    id BIGSERIAL PRIMARY KEY,
    strike_id VARCHAR(64) UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326),
    peak_current_ka DOUBLE PRECISION NOT NULL,
    polarity VARCHAR(16) NOT NULL, -- POSITIVE, NEGATIVE
    multiplicity INT DEFAULT 1,
    source VARCHAR(64) DEFAULT 'GROUND-NETWORK',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Storm Cells (Convective Cell Detection)
CREATE TABLE IF NOT EXISTS storm_cells (
    id BIGSERIAL PRIMARY KEY,
    storm_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326),
    area_km2 DOUBLE PRECISION NOT NULL,
    radius_km DOUBLE PRECISION NOT NULL,
    intensity DOUBLE PRECISION NOT NULL,
    reflectivity_max_dbz DOUBLE PRECISION NOT NULL,
    direction_deg DOUBLE PRECISION NOT NULL,
    speed_kmh DOUBLE PRECISION NOT NULL,
    growth_rate DOUBLE PRECISION DEFAULT 0.0,
    decay_rate DOUBLE PRECISION DEFAULT 0.0,
    age_minutes INT DEFAULT 0,
    severity VARCHAR(32) NOT NULL, -- LOW, MODERATE, HIGH, SEVERE
    source VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Storm Tracks (Trajectory Projection & Waypoints)
CREATE TABLE IF NOT EXISTS storm_tracks (
    id BIGSERIAL PRIMARY KEY,
    storm_id VARCHAR(64) NOT NULL,
    forecast_base_time TIMESTAMPTZ NOT NULL,
    minutes_ahead INT NOT NULL, -- 15, 30, 60, 120, 180, 360
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326),
    uncertainty_radius_km DOUBLE PRECISION NOT NULL,
    estimated_arrival TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. 1–3 km Hyper-Local Hazard Predictions
CREATE TABLE IF NOT EXISTS hazard_predictions (
    id BIGSERIAL PRIMARY KEY,
    grid_id VARCHAR(64) NOT NULL,
    prediction_timestamp TIMESTAMPTZ NOT NULL,
    forecast_minutes INT NOT NULL,
    center_latitude DOUBLE PRECISION NOT NULL,
    center_longitude DOUBLE PRECISION NOT NULL,
    cell_polygon GEOMETRY(Polygon, 4326),
    storm_probability DOUBLE PRECISION NOT NULL,
    lightning_probability DOUBLE PRECISION NOT NULL,
    hail_probability DOUBLE PRECISION NOT NULL,
    heavy_rain_probability DOUBLE PRECISION NOT NULL,
    strong_wind_probability DOUBLE PRECISION NOT NULL,
    extreme_rain_probability DOUBLE PRECISION NOT NULL,
    cloudburst_risk DOUBLE PRECISION DEFAULT 0.0,
    confidence VARCHAR(32) NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    source VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. Convective Initiation Warnings
CREATE TABLE IF NOT EXISTS warnings (
    id BIGSERIAL PRIMARY KEY,
    warning_id VARCHAR(64) UNIQUE NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    impact_buffer_km DOUBLE PRECISION DEFAULT 3.0,
    severity VARCHAR(32) NOT NULL,
    status_level VARCHAR(32) NOT NULL,
    headline TEXT NOT NULL,
    operational_attention TEXT NOT NULL,
    eta_minutes DOUBLE PRECISION,
    confidence VARCHAR(32) NOT NULL,
    provenance_meta JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 10. AI / ML Model Versions & Metadata
CREATE TABLE IF NOT EXISTS model_versions (
    id SERIAL PRIMARY KEY,
    version_tag VARCHAR(64) UNIQUE NOT NULL,
    architecture VARCHAR(255) NOT NULL,
    trained_at TIMESTAMPTZ,
    training_data_source TEXT,
    csi_score DOUBLE PRECISION,
    pod_score DOUBLE PRECISION,
    far_score DOUBLE PRECISION,
    brier_score DOUBLE PRECISION,
    model_artifact_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. Data Sources Health & Availability Tracking
CREATE TABLE IF NOT EXISTS data_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) UNIQUE NOT NULL,
    source_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL, -- LIVE, STALE, NOT_CONNECTED, ERROR, DEMO
    last_update TIMESTAMPTZ,
    latency_ms DOUBLE PRECISION,
    error_count INT DEFAULT 0,
    message TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 12. Spatial & Temporal Indexes
CREATE INDEX IF NOT EXISTS weather_obs_ts_idx ON weather_observations(timestamp);
CREATE INDEX IF NOT EXISTS weather_obs_geom_idx ON weather_observations USING GIST(geom);
CREATE INDEX IF NOT EXISTS storm_cells_ts_idx ON storm_cells(timestamp);
CREATE INDEX IF NOT EXISTS storm_cells_geom_idx ON storm_cells USING GIST(geom);
CREATE INDEX IF NOT EXISTS lightning_geom_idx ON lightning_observations USING GIST(geom);
CREATE INDEX IF NOT EXISTS hazard_geom_idx ON hazard_predictions USING GIST(cell_polygon);
CREATE INDEX IF NOT EXISTS warnings_valid_idx ON warnings(valid_until);
