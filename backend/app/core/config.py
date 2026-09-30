from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal

class Settings(BaseSettings):
    app_env: str = "development"
    data_mode: Literal["real", "demo"] = "real"
    database_url: str = "sqlite:///./storm_nowcasting.db"
    redis_url: str = "redis://redis:6379/0"
    frontend_url: str = "http://localhost:5173"
    imd_api_url: str = "https://api.imd.gov.in"
    imd_api_key: str = ""
    imd_radar_url: str = ""
    mosdac_username: str = ""
    mosdac_password: str = ""
    mosdac_api_url: str = ""
    mosdac_dataset_id: str = ""
    lightning_api_url: str = ""
    lightning_api_key: str = ""
    weather_api_url: str = ""
    weather_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    ingest_interval_seconds: int = 300
    stale_after_minutes: int = 15
    india_min_lon: float = 68.0
    india_max_lon: float = 98.0
    india_min_lat: float = 6.0
    india_max_lat: float = 37.5
    grid_km: float = 3.0
    model_version: str = "baseline-v0.1"
    model_path: str = "ml/artifacts/model.joblib"
    alert_threshold: float = 0.70
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

settings = Settings()
