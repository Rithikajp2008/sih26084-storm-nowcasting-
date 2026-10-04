import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Circle, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

import {
  Mode,
  DataSourceHealth,
  StormCell,
  LightningStrike,
  ConvectiveInitiationSignal,
  HazardSummary,
  CurrentWeather,
  RainComingOutlook,
  StormArrivalCountdown,
  GridPrediction,
  UserWarning,
  WhyThisAlert,
} from './types';

// Fix Leaflet default marker icon paths in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const API = import.meta.env.VITE_API_URL || (
  typeof window !== 'undefined' && window.location.hostname.includes('render.com')
    ? 'https://sih26084-storm-backend.onrender.com'
    : ''
);
const WS = API
  ? API.replace(/^http/, 'ws') + '/ws/live'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/live`;


const CITIES = [
  { name: '📍 Auto-Detect Current Location', lat: 13.0827, lon: 80.2707 },
  { name: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
  { name: 'New Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { name: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
  { name: 'Hyderabad', lat: 17.3850, lon: 78.4867 },
  { name: 'Guwahati (Eastern Convective Zone)', lat: 26.1445, lon: 91.7362 },
  { name: 'Bhubaneswar (Odisha Coast)', lat: 20.2961, lon: 85.8245 },
  { name: 'Coimbatore', lat: 11.0168, lon: 76.9558 },
  { name: 'Madurai', lat: 9.9252, lon: 78.1198 },
  { name: 'Pune', lat: 18.5204, lon: 73.8567 },
  { name: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
];

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Controller to fly map to coordinates when location changes
function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, 10, { duration: 1.2 });
  }, [center[0], center[1], map]);
  return null;
}

function MapClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationSelect(Number(e.latlng.lat.toFixed(4)), Number(e.latlng.lng.toFixed(4)));
    },
  });
  return null;
}

function App() {
  // System state
  const [mode, setMode] = useState<Mode>('demo');
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [utcTime, setUtcTime] = useState<string>('');
  const [istTime, setIstTime] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');

  // Location state (Default Chennai, but auto-detects browser GPS)
  const [selectedCity, setSelectedCity] = useState<string>('My Location');
  const [lat, setLat] = useState<number>(13.0827);
  const [lon, setLon] = useState<number>(80.2707);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationSuccess, setLocationSuccess] = useState<boolean>(false);

  // Nowcast timeline state
  const [forecastMinutes, setForecastMinutes] = useState<number>(30);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playTimerRef = useRef<number | null>(null);

  // Map layer toggles & basemap (Default to Google Maps Roadmap - crisp, zero watermark!)
  const [basemap, setBasemap] = useState<'google-roadmap' | 'google-satellite' | 'google-terrain' | 'osm'>('google-roadmap');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showRadar, setShowRadar] = useState<boolean>(true);
  const [showStorms, setShowStorms] = useState<boolean>(true);
  const [showTrajectory, setShowTrajectory] = useState<boolean>(true);
  const [showLightning, setShowLightning] = useState<boolean>(true);
  const [showCI, setShowCI] = useState<boolean>(true);
  const [showBuffer, setShowBuffer] = useState<boolean>(true);
  const [show30kmRadius, setShow30kmRadius] = useState<boolean>(true);

  // Telemetry data
  const [health, setHealth] = useState<DataSourceHealth[]>([]);
  const [currentWeather, setCurrentWeather] = useState<CurrentWeather | null>(null);
  const [storms, setStorms] = useState<StormCell[]>([]);
  const [lightningStrikes, setLightningStrikes] = useState<LightningStrike[]>([]);
  const [grid, setGrid] = useState<GridPrediction[]>([]);
  const [convectiveInitiation, setConvectiveInitiation] = useState<ConvectiveInitiationSignal | null>(null);
  const [hazards, setHazards] = useState<HazardSummary | null>(null);
  const [rainComing, setRainComing] = useState<RainComingOutlook | null>(null);
  const [countdown, setCountdown] = useState<StormArrivalCountdown | null>(null);
  const [warning, setWarning] = useState<UserWarning | null>(null);
  const [whyAlert, setWhyAlert] = useState<WhyThisAlert | null>(null);

  // GPS Current Location Detection
  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const uLat = Number(pos.coords.latitude.toFixed(4));
        const uLon = Number(pos.coords.longitude.toFixed(4));
        setLat(uLat);
        setLon(uLon);
        setSelectedCity(`Current Location (${uLat}°N, ${uLon}°E)`);
        setIsLocating(false);
        setLocationSuccess(true);
      },
      (err) => {
        console.warn('Geolocation access failed or denied:', err.message);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Attempt auto-detect on initial load
  useEffect(() => {
    detectLocation();
  }, [detectLocation]);

  // Real-time ticking clocks
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().slice(17, 25) + ' UTC');
      const istString = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
      setIstTime(istString + ' IST');
    };
    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  // Main data loader
  const loadAllData = useCallback(async () => {
    try {
      setErrorBanner('');
      const [mRes, hRes, cwRes, stRes, ltRes, ciRes, hzRes, rcRes, cdRes, wnRes, gdRes, whyRes] =
        await Promise.allSettled([
          fetchJson<{ data_mode: Mode }>(`${API}/api/mode`),
          fetchJson<{ data: DataSourceHealth[] }>(`${API}/api/system-health`),
          fetchJson<{ data: CurrentWeather }>(`${API}/api/current-weather?lat=${lat}&lon=${lon}&city=${encodeURIComponent(selectedCity.split(' ')[0])}`),
          fetchJson<{ data: StormCell[] }>(`${API}/api/storms/live?lat=${lat}&lon=${lon}`),
          fetchJson<{ data: LightningStrike[] }>(`${API}/api/lightning?lat=${lat}&lon=${lon}`),
          fetchJson<{ data: ConvectiveInitiationSignal }>(`${API}/api/convective-initiation?lat=${lat}&lon=${lon}`),
          fetchJson<{ data: HazardSummary }>(`${API}/api/hazards?minutes=${forecastMinutes}&lat=${lat}&lon=${lon}`),
          fetchJson<{ data: RainComingOutlook }>(`${API}/api/rain-coming?lat=${lat}&lon=${lon}`),
          fetchJson<{ data: StormArrivalCountdown }>(`${API}/api/storm-countdown?lat=${lat}&lon=${lon}`),
          fetchJson<{ warning: UserWarning }>(`${API}/api/user-warning?lat=${lat}&lon=${lon}`),
          fetchJson<{ data: GridPrediction[] }>(`${API}/api/forecast?minutes=${forecastMinutes}&lat=${lat}&lon=${lon}`),
          fetchJson<{ data: WhyThisAlert }>(`${API}/api/why-alert?alert_id=ALT-001`),
        ]);

      if (mRes.status === 'fulfilled') setMode(mRes.value.data_mode);
      if (hRes.status === 'fulfilled') setHealth(hRes.value.data || []);
      if (cwRes.status === 'fulfilled') setCurrentWeather(cwRes.value.data || null);
      if (stRes.status === 'fulfilled') setStorms(stRes.value.data || []);
      if (ltRes.status === 'fulfilled') setLightningStrikes(ltRes.value.data || []);
      if (ciRes.status === 'fulfilled') setConvectiveInitiation(ciRes.value.data || null);
      if (hzRes.status === 'fulfilled') setHazards(hzRes.value.data || null);
      if (rcRes.status === 'fulfilled') setRainComing(rcRes.value.data || null);
      if (cdRes.status === 'fulfilled') setCountdown(cdRes.value.data || null);
      if (wnRes.status === 'fulfilled') setWarning(wnRes.value.warning || null);
      if (gdRes.status === 'fulfilled') setGrid(gdRes.value.data || []);
      if (whyRes.status === 'fulfilled') setWhyAlert(whyRes.value.data || null);
    } catch (err: any) {
      setErrorBanner(err.message || 'Error communicating with nowcasting backend');
    }
  }, [lat, lon, selectedCity, forecastMinutes]);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // WebSocket Live Stream
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimeout: number | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      setWsStatus('connecting');
      ws = new WebSocket(WS);

      ws.onopen = () => setWsStatus('connected');
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.mode && payload.mode !== mode) setMode(payload.mode);
          if (payload.storms && payload.storms.length > 0) setStorms(payload.storms);
          if (payload.countdown) setCountdown(payload.countdown);
          if (payload.rain_coming) setRainComing(payload.rain_coming);
        } catch {
          // ignore malformed frame
        }
      };
      ws.onerror = () => setWsStatus('disconnected');
      ws.onclose = () => {
        setWsStatus('disconnected');
        if (!unmounted) retryTimeout = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      unmounted = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      ws?.close();
    };
  }, [mode]);

  // Toggle Mode function
  const handleToggleMode = async () => {
    try {
      const res = await fetchJson<{ data_mode: Mode }>(`${API}/api/mode/toggle`, { method: 'POST' });
      setMode(res.data_mode);
      void loadAllData();
    } catch (err: any) {
      setErrorBanner(`Failed to toggle mode: ${err.message}`);
    }
  };

  // Play / Pause timeline simulation
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }
    const intervals = [15, 30, 60, 120, 180, 240, 360];
    playTimerRef.current = window.setInterval(() => {
      setForecastMinutes((prev) => {
        const nextIdx = (intervals.indexOf(prev) + 1) % intervals.length;
        return intervals[nextIdx];
      });
    }, 2500);

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying]);

  // Handle city selection
  const handleCityChange = (cityName: string) => {
    if (cityName.includes('Auto-Detect')) {
      detectLocation();
      return;
    }
    setSelectedCity(cityName);
    const found = CITIES.find((c) => c.name === cityName);
    if (found) {
      setLat(found.lat);
      setLon(found.lon);
    }
  };

  // Color helper for hazard probability
  const getProbColor = (p: number) => {
    if (p >= 0.75) return '#ef4444'; // Red (Severe)
    if (p >= 0.50) return '#f59e0b'; // Amber (Alert)
    if (p >= 0.25) return '#3b82f6'; // Blue (Watch)
    return '#10b981'; // Green (Stable)
  };

  // Basemap Tile Layer - Google Maps by default, crisp and without any watermarks!
  const basemapUrl = useMemo(() => {
    if (basemap === 'google-satellite') {
      return 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
    }
    if (basemap === 'google-terrain') {
      return 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}';
    }
    if (basemap === 'osm') {
      return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
    // Google Maps Roadmap default: Official, clear streets, towns & zero watermark
    return 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
  }, [basemap]);

  return (
    <div className="command-center">
      {/* ---------------- 1. HEADER (NO SIH BOX) ---------------- */}
      <header className="cc-header">
        <div className="header-brand">
          <div className="brand-emblem">⚡</div>
          <div className="brand-text">
            <h1>CONVECTIVE STORM NOWCASTING (0–6 HR)</h1>
            <div className="brand-subtitle">
              Ministry of Earth Sciences (MoES) • National Centre for Medium Range Weather Forecasting (NCMRWF) • India
            </div>
          </div>
        </div>

        <div className="header-status-group">
          <div className="clock-panel">
            <div className="clock-item">
              <span>IST:</span>
              <b>{istTime || 'Loading IST...'}</b>
            </div>
            <div className="clock-item">
              <span>UTC:</span>
              <b>{utcTime || 'Loading UTC...'}</b>
            </div>
          </div>

          <div className="ws-badge">
            <div className={`ws-dot ${wsStatus}`} />
            <span>WS: {wsStatus.toUpperCase()}</span>
          </div>

          <div className="mode-control">
            <div className={`mode-pill ${mode}`}>
              {mode === 'demo' ? '🟡 DEMO / SIMULATION MODE' : '🟢 REAL DATA MODE'}
            </div>
            <button className="btn-toggle-mode" onClick={handleToggleMode} title="Toggle between Real observations and Demo scenario">
              {mode === 'demo' ? 'Switch to Real Data' : 'Run Demo Scenario'}
            </button>
          </div>
        </div>
      </header>

      {/* ---------------- 2. ALERT TICKER ---------------- */}
      {errorBanner ? (
        <div className="alert-ticker" style={{ background: '#3b181b', borderColor: '#ef4444' }}>
          <span className="ticker-tag" style={{ background: '#ef4444' }}>BACKEND NOTICE</span>
          <span>{errorBanner}</span>
        </div>
      ) : warning && warning.severity !== 'LOW' ? (
        <div className="alert-ticker">
          <span className="ticker-tag">{warning.severity} ADVISORY</span>
          <span>{warning.headline} — {warning.operational_attention}</span>
        </div>
      ) : (
        <div className="alert-ticker" style={{ background: '#0e1c26', color: '#93c5fd', borderColor: '#1e3a5f' }}>
          <span className="ticker-tag" style={{ background: '#3b82f6' }}>30 KM RADIUS ACTIVE</span>
          <span>Monitoring real-time convective initiation, Doppler radar cores, and cloudburst hazards within 30 km of your location.</span>
        </div>
      )}

      {/* ---------------- 3. MAIN WORKSPACE ---------------- */}
      <main className="cc-body">
        {/* LEFT/CENTER: GIS MAP */}
        <section className="map-viewport">
          <div className="map-tactical-bar">
            {/* 1-Click Detect Location Button */}
            <button
              className="btn-locate"
              onClick={detectLocation}
              disabled={isLocating}
              title="Detect your exact GPS location via browser"
            >
              {isLocating ? '⏳ Locating...' : '📍 My Current Location'}
            </button>

            <div className="map-control-group">
              <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>LOCATION:</span>
              <select
                className="map-select"
                value={selectedCity}
                onChange={(e) => handleCityChange(e.target.value)}
              >
                {CITIES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="map-control-group">
              <span style={{ color: 'var(--text-dim)', fontWeight: 700 }}>MAP STYLE:</span>
              <select
                className="map-select"
                value={basemap}
                onChange={(e) => setBasemap(e.target.value as any)}
              >
                <option value="google-roadmap">Google Maps (Roadmap)</option>
                <option value="google-satellite">Google Satellite (Hybrid)</option>
                <option value="google-terrain">Google Terrain</option>
                <option value="osm">OpenStreetMap Standard</option>
              </select>
            </div>

            <label className="layer-toggle" title="Show 30 km early warning weather coverage circle">
              <input type="checkbox" checked={show30kmRadius} onChange={(e) => setShow30kmRadius(e.target.checked)} />
              30 km Weather Radius
            </label>

            <label className="layer-toggle">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              1–3 km Hazard Grid
            </label>

            <label className="layer-toggle">
              <input type="checkbox" checked={showStorms} onChange={(e) => setShowStorms(e.target.checked)} />
              Storm Cells
            </label>

            <label className="layer-toggle">
              <input type="checkbox" checked={showTrajectory} onChange={(e) => setShowTrajectory(e.target.checked)} />
              0–6h Trajectory
            </label>

            <label className="layer-toggle">
              <input type="checkbox" checked={showLightning} onChange={(e) => setShowLightning(e.target.checked)} />
              Lightning Strikes
            </label>

            <label className="layer-toggle">
              <input type="checkbox" checked={showCI} onChange={(e) => setShowCI(e.target.checked)} />
              CI Hotspots
            </label>
          </div>

          <MapContainer
            center={[lat, lon]}
            zoom={10}
            className="map-container"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; Google Maps | OpenStreetMap contributors'
              url={basemapUrl}
            />

            {/* Recenter map smoothly when location changes */}
            <MapRecenter center={[lat, lon]} />

            <MapClickHandler
              onLocationSelect={(newLat, newLon) => {
                setLat(newLat);
                setLon(newLon);
                setSelectedCity(`Selected Point (${newLat}, ${newLon})`);
              }}
            />

            {/* User Selected / Current GPS Location Marker */}
            <Marker position={[lat, lon]}>
              <Popup>
                <div style={{ fontSize: 12 }}>
                  <b style={{ color: '#0284c7' }}>📍 Current Location</b>
                  <hr style={{ margin: '4px 0', borderColor: '#cbd5e1' }} />
                  <div>Coordinates: <b>{lat.toFixed(4)}°N, {lon.toFixed(4)}°E</b></div>
                  <div>Coverage: <b>30 km Radius</b></div>
                  <div style={{ color: '#059669', marginTop: 4, fontWeight: 600 }}>Active Early-Warning Monitoring</div>
                </div>
              </Popup>
            </Marker>

            {/* 30 KM EARLY-WARNING & WEATHER COVERAGE RADIUS (Requested by User) */}
            {show30kmRadius && (
              <Circle
                center={[lat, lon]}
                radius={30000} // 30,000 meters = 30 km radius
                pathOptions={{
                  color: '#0284c7',
                  weight: 2,
                  dashArray: '6, 6',
                  fillColor: '#38bdf8',
                  fillOpacity: 0.08,
                }}
              >
                <Popup>
                  <div style={{ fontSize: 12 }}>
                    <b style={{ color: '#0284c7' }}>📍 30 km Nowcasting Coverage Radius</b>
                    <hr style={{ margin: '4px 0', borderColor: '#cbd5e1' }} />
                    <div>Center: <b>{lat.toFixed(4)}°N, {lon.toFixed(4)}°E</b></div>
                    <div>Monitoring Area: <b>~2,827 km² around your location</b></div>
                    <div style={{ marginTop: 4, color: '#475569' }}>Tracking thunderstorms, hail cores, downbursts & cloudbursts within 30 km.</div>
                  </div>
                </Popup>
              </Circle>
            )}

            {/* Inner 3 km Immediate Impact Buffer */}
            {showBuffer && (
              <Circle
                center={[lat, lon]}
                radius={3000}
                pathOptions={{
                  color: '#ef4444',
                  weight: 2,
                  dashArray: '4, 4',
                  fillColor: '#ef4444',
                  fillOpacity: 0.12,
                }}
              >
                <Popup>3 km Immediate Convective Impact Buffer</Popup>
              </Circle>
            )}

            {/* 1–3 km Hyper-Local Hazard Grid */}
            {showGrid &&
              grid.map((g, i) => {
                const color = getProbColor(g.storm_probability);
                const coords = g.geometry.coordinates[0].map((pt) => [pt[1], pt[0]] as [number, number]);
                return (
                  <Polygon
                    key={`${g.grid_id}-${i}`}
                    positions={coords}
                    pathOptions={{
                      color: color,
                      weight: 1,
                      fillColor: color,
                      fillOpacity: Math.max(0.12, g.storm_probability * 0.7),
                    }}
                  >
                    <Popup>
                      <div style={{ fontSize: 12, minWidth: 160 }}>
                        <b style={{ color: '#00d4ff' }}>3 km Hazard Grid Cell</b> ({g.grid_id})
                        <hr style={{ margin: '4px 0', borderColor: '#334155' }} />
                        <div>Storm Prob: <b>{(g.storm_probability * 100).toFixed(0)}%</b></div>
                        <div>Lightning: <b>{(g.lightning_probability * 100).toFixed(0)}%</b></div>
                        <div>Hail Prob: <b>{(g.hail_probability * 100).toFixed(0)}%</b></div>
                        <div>Heavy Rain: <b>{(g.heavy_rain_probability * 100).toFixed(0)}%</b></div>
                        <div>Severe Wind: <b>{(g.strong_wind_probability * 100).toFixed(0)}%</b></div>
                        <div>Cloudburst: <b>{(g.extreme_rain_probability * 100).toFixed(0)}%</b></div>
                        <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 10 }}>Lead Time: +{g.forecast_minutes}m</div>
                      </div>
                    </Popup>
                  </Polygon>
                );
              })}

            {/* Active Storm Cells within 30 km */}
            {showStorms &&
              storms.map((s) => (
                <React.Fragment key={s.cell_id}>
                  {/* Outer Footprint */}
                  <Circle
                    center={[s.latitude, s.longitude]}
                    radius={s.radius_km * 1000}
                    pathOptions={{
                      color: s.severity === 'SEVERE' ? '#ef4444' : '#f59e0b',
                      fillColor: s.severity === 'SEVERE' ? '#ef4444' : '#f59e0b',
                      fillOpacity: 0.28,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div style={{ fontSize: 12, minWidth: 200 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <b style={{ color: '#f87171' }}>{s.cell_id}</b>
                          <span className={`storm-trend-badge ${s.trend?.toLowerCase() || 'intensifying'}`}>
                            {s.trend === 'INTENSIFYING' ? '🔥 INTENSIFYING' : s.trend === 'WEAKENING' ? '📉 WEAKENING' : '⚖️ STABLE'}
                          </span>
                        </div>
                        <hr style={{ margin: '4px 0', borderColor: '#475569' }} />
                        <div>Severity: <b>{s.severity}</b></div>
                        <div>Reflectivity: <b>{s.reflectivity_max_dbz} dBZ</b></div>
                        <div>Motion: <b>{s.speed_kmh} km/h @ {s.direction_deg}° ({s.direction_compass})</b></div>
                        <div>Area: <b>{s.area_km2} km²</b> (Radius: {s.radius_km} km)</div>
                        <div>Growth Rate: <b>+{s.growth_rate} /hr</b></div>
                        <div>Age: <b>{s.age_minutes} min</b></div>
                        <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 10 }}>Source: {s.source}</div>
                      </div>
                    </Popup>
                  </Circle>

                  {/* High Intensity Reflectivity Core */}
                  <Circle
                    center={[s.latitude, s.longitude]}
                    radius={(s.radius_km * 1000) / 2.5}
                    pathOptions={{
                      color: '#ec4899',
                      fillColor: '#ec4899',
                      fillOpacity: 0.6,
                      weight: 1,
                    }}
                  />
                </React.Fragment>
              ))}

            {/* 0–6h Predicted Trajectory Cone & Line */}
            {showTrajectory &&
              storms.map((s) => {
                if (!s.trajectory || s.trajectory.length === 0) return null;
                const pathPoints = [
                  [s.latitude, s.longitude] as [number, number],
                  ...s.trajectory.map((t) => [t.latitude, t.longitude] as [number, number]),
                ];
                return (
                  <React.Fragment key={`traj-${s.cell_id}`}>
                    <Polyline
                      positions={pathPoints}
                      pathOptions={{ color: '#00d4ff', weight: 3, dashArray: '4, 4' }}
                    />
                    {s.trajectory.map((tp, idx) => (
                      <Circle
                        key={`tp-${idx}`}
                        center={[tp.latitude, tp.longitude]}
                        radius={tp.uncertainty_radius_km * 400}
                        pathOptions={{
                          color: '#38bdf8',
                          fillColor: '#38bdf8',
                          fillOpacity: 0.15,
                          weight: 1,
                        }}
                      >
                        <Popup>
                          <b>Waypoint +{tp.minutes_ahead}m</b>
                          <br />
                          Arrival: {new Date(tp.estimated_arrival).toLocaleTimeString()}
                          <br />
                          Uncertainty Radius: {tp.uncertainty_radius_km} km
                        </Popup>
                      </Circle>
                    ))}
                  </React.Fragment>
                );
              })}

            {/* Live Lightning Strikes */}
            {showLightning &&
              lightningStrikes.map((ls) => (
                <Circle
                  key={ls.strike_id}
                  center={[ls.latitude, ls.longitude]}
                  radius={750}
                  pathOptions={{
                    color: '#facc15',
                    fillColor: '#facc15',
                    fillOpacity: Math.max(0.3, 1.0 - ls.age_seconds / 500),
                    weight: 2,
                  }}
                >
                  <Popup>
                    <b>Lightning Stroke {ls.strike_id}</b>
                    <br />
                    Peak Current: <b>{ls.peak_current_ka} kA</b> ({ls.polarity})
                    <br />
                    Age: {ls.age_seconds}s ago
                  </Popup>
                </Circle>
              ))}

            {/* Convective Initiation Danger Zone */}
            {showCI && convectiveInitiation && convectiveInitiation.detected && (
              <Circle
                center={[convectiveInitiation.latitude + 0.05, convectiveInitiation.longitude - 0.04]}
                radius={4500}
                pathOptions={{
                  color: '#8b5cf6',
                  fillColor: '#8b5cf6',
                  fillOpacity: 0.25,
                  weight: 2,
                  dashArray: '2, 6',
                }}
              >
                <Popup>
                  <b>⚡ Convective Initiation Zone</b>
                  <br />
                  Level: <b>{convectiveInitiation.initiation_level}</b>
                  <br />
                  Confidence: {(convectiveInitiation.confidence * 100).toFixed(0)}%
                  <br />
                  Cloud-Top Temp: {convectiveInitiation.cloud_top_temp_c}°C
                  <br />
                  Reflectivity Surge: +{convectiveInitiation.reflectivity_growth_dbz_per_hr} dBZ/hr
                </Popup>
              </Circle>
            )}
          </MapContainer>

          {/* Map Bottom Legend */}
          <div className="map-legend-bar">
            <div className="legend-title">
              <span>DWR REFLECTIVITY (dBZ)</span>
              <span>1–3 KM CONVECTIVE CORE</span>
            </div>
            <div className="legend-scale">
              <div className="legend-step" style={{ background: '#3b82f6' }} title="20 dBZ Light Rain" />
              <div className="legend-step" style={{ background: '#10b981' }} title="30 dBZ Moderate Rain" />
              <div className="legend-step" style={{ background: '#facc15' }} title="40 dBZ Heavy Rain" />
              <div className="legend-step" style={{ background: '#f97316' }} title="48 dBZ Thunderstorm" />
              <div className="legend-step" style={{ background: '#ef4444' }} title="55 dBZ Hail / Severe" />
              <div className="legend-step" style={{ background: '#a855f7' }} title="65+ dBZ Extreme Cloudburst Core" />
            </div>
            <div className="legend-labels">
              <span>20 dBZ</span>
              <span>30</span>
              <span>40</span>
              <span>48</span>
              <span>55</span>
              <span>65+ dBZ</span>
            </div>
          </div>
        </section>

        {/* RIGHT: TACTICAL CONTROL PANEL */}
        <aside className="tactical-sidebar">
          {/* A. Weather Status Indicator */}
          {currentWeather && (
            <div className={`status-banner ${currentWeather.status_level.toLowerCase()}`}>
              <div className="status-head">
                <span className="status-title">STATUS: {currentWeather.status_level}</span>
                <span className="t-badge" style={{ background: 'rgba(0,0,0,0.3)', color: '#fff' }}>
                  {currentWeather.weather_condition}
                </span>
              </div>
              <div className="status-reason">{currentWeather.status_reason}</div>
            </div>
          )}

          {/* B. Storm Arrival Countdown */}
          <div className="t-card">
            <div className="t-card-header">
              <div className="t-card-title">
                <span>⏱️</span> STORM ARRIVAL COUNTDOWN
              </div>
              <span className="t-badge alert">ETA TELEMETRY</span>
            </div>
            {countdown && countdown.active_storm_detected ? (
              <div className="countdown-box">
                <div className="countdown-time">{countdown.countdown_str}</div>
                <div className="countdown-sub">
                  <span>Dist: <b>{countdown.distance_km} km</b></span>
                  <span>Approach: <b>{countdown.direction_compass}</b></span>
                  <span>Confidence: <b>{countdown.confidence_percent}%</b></span>
                </div>
                {countdown.arrival_clock_time && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                    Est. Arrival Time: {countdown.arrival_clock_time}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No active convective storm cell intersecting 3 km buffer.
              </div>
            )}
          </div>

          {/* Active Storms & Trend Tracking (SIH26084 Section 6) */}
          {storms.length > 0 && (
            <div className="t-card">
              <div className="t-card-header">
                <div className="t-card-title">
                  <span>🌀</span> STORM CELLS & TREND TRACKING
                </div>
                <span className="t-badge alert">{storms.length} ACTIVE</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {storms.map((st) => (
                  <div
                    key={st.cell_id}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b style={{ color: '#f87171', fontSize: 12 }}>{st.cell_id}</b>
                      <span className={`storm-trend-badge ${st.trend?.toLowerCase() || 'intensifying'}`}>
                        {st.trend === 'INTENSIFYING' ? '🔥 INTENSIFYING' : st.trend === 'WEAKENING' ? '📉 WEAKENING' : '⚖️ STABLE'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Core: <b style={{ color: '#ec4899' }}>{st.reflectivity_max_dbz} dBZ</b></span>
                      <span>Motion: <b>{st.speed_kmh} km/h @ {st.direction_compass}</b></span>
                      <span>Radius: <b>{st.radius_km} km</b></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* C. "Rain Coming?" Feature */}
          <div className="t-card">
            <div className="t-card-header">
              <div className="t-card-title">
                <span>🌧️</span> RAIN COMING?
              </div>
              <span className={`t-badge ${rainComing?.expected ? 'severe' : 'stable'}`}>
                {rainComing?.expected ? 'CONFIRMED' : 'CLEAR'}
              </span>
            </div>
            {rainComing && (
              <div>
                <div className={`rain-verdict ${rainComing.expected ? '' : 'no-rain'}`}>
                  <div className="rain-headline">
                    {rainComing.expected
                      ? `YES – HIGH PROBABILITY (${rainComing.probability_percent}%)`
                      : 'NO SIGNIFICANT RAINFALL EXPECTED'}
                  </div>
                  {rainComing.expected && (
                    <div className="rain-meta">
                      Expected Arrival: <b>{rainComing.arrival_minutes ? `${rainComing.arrival_minutes} min` : 'Underway'}</b> • Intensity: <b>{rainComing.expected_intensity}</b> • Duration: <b>{rainComing.expected_duration_min}</b>
                    </div>
                  )}
                </div>

                <div className="outlook-bars">
                  {[
                    { label: '+15m', val: rainComing.outlook_15m },
                    { label: '+30m', val: rainComing.outlook_30m },
                    { label: '+1h', val: rainComing.outlook_1h },
                    { label: '+3h', val: rainComing.outlook_3h },
                    { label: '+6h', val: rainComing.outlook_6h },
                  ].map((ob) => (
                    <div className="outlook-bar-item" key={ob.label}>
                      <div className="bar-time">{ob.label}</div>
                      <div className="bar-container">
                        <div className="bar-fill" style={{ height: `${ob.val}%` }} />
                      </div>
                      <div className="bar-pct">{ob.val}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* D. Current Weather Panel (Within 30 km Radius) */}
          {currentWeather && (
            <div className="t-card">
              <div className="t-card-header">
                <div className="t-card-title">
                  <span>🌡️</span> CURRENT WEATHER (30 KM RADIUS OF YOUR LOCATION)
                </div>
                <span className="t-badge watch">30 KM ZONE</span>
              </div>
              <div className="weather-grid">
                <div className="w-item">
                  <div className="w-label">Temperature</div>
                  <div className="w-value">{currentWeather.temperature.toFixed(1)}<span className="w-unit">°C</span></div>
                </div>
                <div className="w-item">
                  <div className="w-label">Humidity</div>
                  <div className="w-value">{currentWeather.humidity.toFixed(0)}<span className="w-unit">%</span></div>
                </div>
                <div className="w-item">
                  <div className="w-label">Wind</div>
                  <div className="w-value">{currentWeather.wind_speed.toFixed(0)}<span className="w-unit">km/h {currentWeather.wind_direction_compass}</span></div>
                </div>
                <div className="w-item">
                  <div className="w-label">Pressure</div>
                  <div className="w-value">{currentWeather.pressure.toFixed(1)}<span className="w-unit">hPa</span></div>
                </div>
                <div className="w-item">
                  <div className="w-label">Rainfall Rate</div>
                  <div className="w-value">{currentWeather.rainfall_rate_mm_h.toFixed(1)}<span className="w-unit">mm/h</span></div>
                </div>
                <div className="w-item">
                  <div className="w-label">Cloud Cover</div>
                  <div className="w-value">{currentWeather.cloud_cover_percent?.toFixed(0) || '—'}<span className="w-unit">%</span></div>
                </div>
              </div>
              <div className="w-attribution">
                <span>Location: {selectedCity} ({lat.toFixed(2)}°N, {lon.toFixed(2)}°E)</span>
                <span>{new Date(currentWeather.observation_timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          )}

          {/* E. Convective Initiation (CI) Alert Card */}
          {convectiveInitiation && (
            <div className="t-card">
              <div className="t-card-header">
                <div className="t-card-title">
                  <span>⚡</span> CONVECTIVE INITIATION (CI)
                </div>
                <span className={`t-badge ${convectiveInitiation.detected ? 'severe' : 'stable'}`}>
                  {convectiveInitiation.initiation_level}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#e2e8f0', marginBottom: 8 }}>
                Region: <b>Within 30 km Radius</b> • Confidence: <b>{(convectiveInitiation.confidence * 100).toFixed(0)}%</b>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: 8, borderRadius: 6, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {convectiveInitiation.primary_signals.map((sig, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, color: '#cbd5e1' }}>
                    <span style={{ color: '#00d4ff' }}>▶</span>
                    <span>{sig}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* F. The 5 SIH26084 Hazard Summary Cards */}
          {hazards && (
            <div className="t-card">
              <div className="t-card-header">
                <div className="t-card-title">
                  <span>⚠️</span> 30 KM HAZARD ASSESSMENT (+{forecastMinutes}m)
                </div>
                <span className="t-badge alert">5 HAZARDS</span>
              </div>
              <div className="hazard-list">
                {/* 1. Thunderstorm */}
                <div className="hazard-row">
                  <span className="hazard-name">Thunderstorm</span>
                  <div className="hazard-meter-box">
                    <div className="hazard-progress">
                      <div
                        className="hazard-bar"
                        style={{
                          width: `${hazards.thunderstorm_probability * 100}%`,
                          background: getProbColor(hazards.thunderstorm_probability),
                        }}
                      />
                    </div>
                  </div>
                  <span className="hazard-meta">
                    <b>{(hazards.thunderstorm_probability * 100).toFixed(0)}%</b> ({hazards.thunderstorm_severity})
                  </span>
                </div>

                {/* 2. Lightning */}
                <div className="hazard-row">
                  <span className="hazard-name">Lightning</span>
                  <div className="hazard-meter-box">
                    <div className="hazard-progress">
                      <div
                        className="hazard-bar"
                        style={{
                          width: `${hazards.lightning_probability * 100}%`,
                          background: getProbColor(hazards.lightning_probability),
                        }}
                      />
                    </div>
                  </div>
                  <span className="hazard-meta">
                    <b>{(hazards.lightning_probability * 100).toFixed(0)}%</b> ({hazards.lightning_strike_density_per_km2}/km²)
                  </span>
                </div>

                {/* 3. Hail */}
                <div className="hazard-row">
                  <span className="hazard-name">Hail Hazard</span>
                  <div className="hazard-meter-box">
                    <div className="hazard-progress">
                      <div
                        className="hazard-bar"
                        style={{
                          width: `${hazards.hail_probability * 100}%`,
                          background: getProbColor(hazards.hail_probability),
                        }}
                      />
                    </div>
                  </div>
                  <span className="hazard-meta">
                    <b>{(hazards.hail_probability * 100).toFixed(0)}%</b> ({hazards.hail_estimated_size_cm}cm)
                  </span>
                </div>

                {/* 4. Downburst */}
                <div className="hazard-row">
                  <span className="hazard-name">Downburst / Wind</span>
                  <div className="hazard-meter-box">
                    <div className="hazard-progress">
                      <div
                        className="hazard-bar"
                        style={{
                          width: `${hazards.downburst_probability * 100}%`,
                          background: getProbColor(hazards.downburst_probability),
                        }}
                      />
                    </div>
                  </div>
                  <span className="hazard-meta">
                    <b>{hazards.downburst_max_gust_kmh} km/h</b>
                  </span>
                </div>

                {/* 5. Cloudburst */}
                <div className="hazard-row">
                  <span className="hazard-name">Cloudburst / Rain</span>
                  <div className="hazard-meter-box">
                    <div className="hazard-progress">
                      <div
                        className="hazard-bar"
                        style={{
                          width: `${hazards.cloudburst_probability * 100}%`,
                          background: getProbColor(hazards.cloudburst_probability),
                        }}
                      />
                    </div>
                  </div>
                  <span className="hazard-meta">
                    <b>{hazards.cloudburst_rate_mm_per_hr} mm/h</b> ({hazards.cloudburst_risk_level})
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* G. Local Hazard Warning Card */}
          {warning && (
            <div className="t-card" style={{ borderColor: warning.severity === 'SEVERE' ? '#ef4444' : '#334155' }}>
              <div className="t-card-header">
                <div className="t-card-title">
                  <span>🚨</span> LOCAL HAZARD ADVISORY
                </div>
                <span className={`t-badge ${warning.severity.toLowerCase()}`}>{warning.severity}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
                {warning.headline}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4, marginBottom: 8 }}>
                <b>Guideline:</b> {warning.operational_attention}
              </div>

              {/* Explicit WHAT / WHY / WHEN Triage Box (SIH26084 Section 11) */}
              <div className="what-why-when-box">
                <div className="www-head">⚡ WHAT / WHY / WHEN OPERATIONAL TRIAGE</div>
                <div className="www-row">
                  <div className="www-pill what">WHAT?</div>
                  <div className="www-content">
                    <b>{warning.what_hazard || warning.headline}</b>
                  </div>
                </div>
                <div className="www-row">
                  <div className="www-pill why">WHY?</div>
                  <div className="www-content">
                    <span>{warning.why_reason || warning.operational_attention}</span>
                  </div>
                </div>
                <div className="www-row">
                  <div className="www-pill when">WHEN?</div>
                  <div className="www-content">
                    <span>{warning.when_expected || (warning.eta_minutes ? `Imminent within ~${warning.eta_minutes} min` : 'Next 60–90 min stable')}</span>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
                Valid Until: {new Date(warning.valid_until).toLocaleTimeString()} • Provenance: {warning.confidence}
              </div>
            </div>
          )}

          {/* H. Explainable Predictions ("Why This Alert?") */}
          {whyAlert && (
            <div className="t-card">
              <div className="t-card-header">
                <div className="t-card-title">
                  <span>💡</span> WHY THIS ALERT? (EXPLAINABILITY)
                </div>
                <span className="t-badge watch">AI REASONING</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {whyAlert.primary_factors.map((f, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      padding: 6,
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#00d4ff', fontWeight: 600 }}>
                      <span>{f.factor}</span>
                      <span>{f.weight_percent}% impact</span>
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 10, marginTop: 2 }}>{f.observation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* I. Data-Source Health & Provenance Panel */}
          <div className="t-card">
            <div className="t-card-header">
              <div className="t-card-title">
                <span>📡</span> DATA-SOURCE HEALTH PANEL
              </div>
              <span className="t-badge watch">{mode === 'demo' ? 'SIMULATED FEEDS' : 'REAL FEEDS'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {health.map((h) => (
                <div
                  key={h.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    fontSize: 11,
                  }}
                  title={h.message || ''}
                >
                  <span style={{ color: '#e2e8f0' }}>{h.name}</span>
                  <span
                    className={`t-badge ${
                      h.status === 'LIVE' ? 'stable' : h.status === 'DEMO' ? 'alert' : 'watch'
                    }`}
                  >
                    {h.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      {/* ---------------- 4. BOTTOM TIMELINE SCRUBBER ---------------- */}
      <footer className="cc-timeline-footer">
        <div className="timeline-controls">
          <button className="btn-play" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸ PAUSE NOWCAST' : '▶ SIMULATE 0–6H'}
          </button>

          {/* 0-3h Interactive Slider (Section 7) */}
          <div className="slider-group">
            <div className="slider-label">
              <span>0–3H SLIDER:</span>
              <b>+{Math.min(forecastMinutes, 180)}m</b>
            </div>
            <input
              type="range"
              min="0"
              max="180"
              step="15"
              value={Math.min(forecastMinutes, 180)}
              onChange={(e) => {
                setForecastMinutes(Number(e.target.value));
                setIsPlaying(false);
              }}
              className="nowcast-slider"
              title="Slide between 0 and 3 hours for detailed hyper-local prediction"
            />
            <div className="slider-ticks">
              <span>0h</span>
              <span>+30m</span>
              <span>+1h</span>
              <span>+1.5h</span>
              <span>+2h</span>
              <span>+2.5h</span>
              <span>+3h</span>
            </div>
          </div>

          <div className="timeline-buttons">
            {[15, 30, 60, 120, 180, 240, 360].map((t) => (
              <button
                key={t}
                className={`btn-time ${forecastMinutes === t ? 'active' : ''}`}
                onClick={() => {
                  setForecastMinutes(t);
                  setIsPlaying(false);
                }}
              >
                {t < 60 ? `+${t}m` : `+${t / 60}h`}
              </button>
            ))}
          </div>
        </div>

        <div className="timeline-summary">
          <span>Active Forecast Lead Time: <b className="timeline-tag">+{forecastMinutes} min</b></span>
          <span>Coverage: <b className="timeline-tag">30 km Radius</b></span>
          <span>Resolution: <b className="timeline-tag">1–3 km Hyper-Local</b></span>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
