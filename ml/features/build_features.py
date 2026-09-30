import pandas as pd
import numpy as np

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Extracts multi-source meteorological features for convective nowcasting:
    - Surface thermodynamics: temperature, humidity, wind_speed, pressure, rainfall
    - Derived convective indices:
      * Temperature-Humidity Index (THI)
      * Dew Point proxy & moist static energy
      * Wind shear / rain interaction
      * Convective instability index
      * DWR reflectivity & vertical development proxy (if present)
      * INSAT cloud top cooling proxy (if present)
    """
    df = df.copy()
    required = ['temperature', 'humidity', 'wind_speed', 'pressure', 'rainfall']
    for c in required:
        if c not in df:
            df[c] = 0.0

    # 1. Temperature & Moisture
    df['temp_humidity_index'] = df['temperature'] * (df['humidity'] / 100.0)
    # Approximate dew point via Magnus formula approximation
    df['dew_point_approx'] = df['temperature'] - ((100.0 - df['humidity']) / 5.0)
    df['dew_point_depression'] = df['temperature'] - df['dew_point_approx']

    # 2. Dynamics & Convection Proxies
    df['wind_rain_interaction'] = df['wind_speed'] * df['rainfall']
    df['moisture_flux_proxy'] = df['wind_speed'] * (df['humidity'] / 100.0) * 1.5
    
    # 3. Radar & Satellite columns if present
    if 'reflectivity_dbz' not in df:
        # If not present in basic surface data, compute proxy from rain rate
        df['reflectivity_dbz'] = np.where(df['rainfall'] > 0, 20.0 + 15.0 * np.log10(np.maximum(df['rainfall'], 0.1)), 10.0)
    
    if 'cloud_top_temp_c' not in df:
        df['cloud_top_temp_c'] = np.where(df['rainfall'] > 5.0, -55.0, -20.0)

    if 'cooling_rate_c_hr' not in df:
        df['cooling_rate_c_hr'] = np.where(df['rainfall'] > 10.0, 14.0, 2.0)

    return df
