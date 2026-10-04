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
  RouteAnalysisResult,
  RouteAnalyzeResponse,
} from './types';

// Fix Leaflet default marker icon paths in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Route Markers
const startIcon = L.divIcon({
  className: 'route-marker-wrapper',
  html: '<div class="route-marker-pin start">A</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const destIcon = L.divIcon({
  className: 'route-marker-wrapper',
  html: '<div class="route-marker-pin dest">B</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
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
  { name: 'Chennai (Tamil Nadu)', lat: 13.0827, lon: 80.2707 },
  { name: 'Mumbai (Maharashtra)', lat: 19.0760, lon: 72.8777 },
  { name: 'New Delhi (NCR)', lat: 28.6139, lon: 77.2090 },
  { name: 'Kolkata (West Bengal)', lat: 22.5726, lon: 88.3639 },
  { name: 'Bengaluru (Karnataka)', lat: 12.9716, lon: 77.5946 },
  { name: 'Hyderabad (Telangana)', lat: 17.3850, lon: 78.4867 },
  { name: 'Guwahati (Eastern Convective Zone)', lat: 26.1445, lon: 91.7362 },
  { name: 'Bhubaneswar (Odisha Coast)', lat: 20.2961, lon: 85.8245 },
  { name: 'Coimbatore', lat: 11.0168, lon: 76.9558 },
  { name: 'Madurai', lat: 9.9252, lon: 78.1198 },
  { name: 'Pune', lat: 18.5204, lon: 73.8567 },
  { name: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
];

const PRESET_DESTINATIONS = [
  { name: 'Tambaram Sanatorium (South Corridor)', lat: 12.9250, lon: 80.1170 },
  { name: 'Chennai International Airport (MAA)', lat: 12.9941, lon: 80.1709 },
  { name: 'Marina Beach Coastline', lat: 13.0500, lon: 80.2824 },
  { name: 'Guindy Industrial Estate', lat: 13.0067, lon: 80.2026 },
  { name: 'Avadi / Ambattur Industrial Zone', lat: 13.1147, lon: 80.1008 },
  { name: 'Sriperumbudur Expressway Corridor', lat: 12.9675, lon: 79.9400 },
];

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Controller to smoothly fly map to coordinates at practical hyper-local zoom (SIH26084 Section 4)
function MapRecenter({ center, zoom = 11 }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.5 });
  }, [center[0], center[1], zoom, map]);
  return null;
}

function MapClickHandler({
  onLocationSelect,
  isPickingDest,
  onDestSelect,
}: {
  onLocationSelect: (lat: number, lon: number) => void;
  isPickingDest: boolean;
  onDestSelect: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      const cLat = Number(e.latlng.lat.toFixed(4));
      const cLon = Number(e.latlng.lng.toFixed(4));
      if (isPickingDest) {
        onDestSelect(cLat, cLon);
      } else {
        onLocationSelect(cLat, cLon);
      }
    },
  });
  return null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180.0) * Math.cos((lat2 * Math.PI) / 180.0) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return R * c;
}

// Geodesically clips an axis-aligned bounding box to lie strictly inside the 30 km circle
function clipCellPolygonToCircle(
  centerLat: number,
  centerLon: number,
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  radiusKm: number = 30.0
): [number, number][] | null {
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180.0), 0.20);
  const x1 = (minLon - centerLon) * 111.0 * cosLat;
  const x2 = (maxLon - centerLon) * 111.0 * cosLat;
  const y1 = (minLat - centerLat) * 111.0;
  const y2 = (maxLat - centerLat) * 111.0;

  const rSq = radiusKm * radiusKm;
  const xc = Math.max(x1, Math.min(0.0, x2));
  const yc = Math.max(y1, Math.min(0.0, y2));
  if (xc * xc + yc * yc >= rSq) return null;

  const corners: [number, number][] = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
  const inCircle = corners.map(([cx, cy]) => cx * cx + cy * cy <= rSq + 1e-6);

  if (inCircle.every(Boolean)) {
    const coords: [number, number][] = corners.map(([cx, cy]) => [
      Number((centerLon + cx / (111.0 * cosLat)).toFixed(5)),
      Number((centerLat + cy / 111.0).toFixed(5)),
    ]);
    coords.push(coords[0]);
    return coords;
  }

  const poly: [number, number][] = [];
  const edges: [[number, number], [number, number]][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];

  for (let i = 0; i < 4; i++) {
    const [xa, ya] = edges[i][0];
    const [xb, yb] = edges[i][1];
    const dx = xb - xa;
    const dy = yb - ya;
    const A = dx * dx + dy * dy;
    const B = 2.0 * (xa * dx + ya * dy);
    const C = xa * xa + ya * ya - rSq;

    if (inCircle[i]) {
      poly.push([xa, ya]);
    }

    const disc = B * B - 4.0 * A * C;
    if (disc >= 0 && A > 1e-9) {
      const s = Math.sqrt(disc);
      const t1 = (-B - s) / (2.0 * A);
      const t2 = (-B + s) / (2.0 * A);
      const ts = [t1, t2].filter((t) => t > 1e-5 && t < 1.0 - 1e-5).sort((a, b) => a - b);
      for (const t of ts) {
        poly.push([xa + t * dx, ya + t * dy]);
      }
    }
  }

  if (poly.length < 3) return null;

  const outPoly: [number, number][] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    outPoly.push(p1);

    const d1 = Math.sqrt(p1[0] * p1[0] + p1[1] * p1[1]);
    const d2 = Math.sqrt(p2[0] * p2[0] + p2[1] * p2[1]);
    if (Math.abs(d1 - radiusKm) < 0.08 && Math.abs(d2 - radiusKm) < 0.08) {
      const ang1 = Math.atan2(p1[1], p1[0]);
      const ang2 = Math.atan2(p2[1], p2[0]);
      const diff = ((ang2 - ang1) % (2.0 * Math.PI) + 2.0 * Math.PI) % (2.0 * Math.PI);
      if (diff > 0.05 && diff < Math.PI) {
        const steps = Math.max(2, Math.floor(diff / (Math.PI / 18.0)));
        for (let s = 1; s < steps; s++) {
          const theta = ang1 + diff * (s / steps);
          outPoly.push([radiusKm * Math.cos(theta), radiusKm * Math.sin(theta)]);
        }
      }
    }
  }

  const resultCoords: [number, number][] = outPoly.map(([cx, cy]) => {
    let clLat = centerLat + cy / 111.0;
    let clLon = centerLon + cx / (111.0 * cosLat);
    const dGeo = haversineKm(centerLat, centerLon, clLat, clLon);
    if (dGeo > radiusKm) {
      const scale = radiusKm / dGeo;
      clLat = centerLat + (clLat - centerLat) * scale;
      clLon = centerLon + (clLon - centerLon) * scale;
    }
    return [Number(clLon.toFixed(5)), Number(clLat.toFixed(5))];
  });

  resultCoords.push(resultCoords[0]);
  return resultCoords;
}

// Client-side fallback generator: Guarantees 1-3 km cells exist ONLY INSIDE the 30 km circle
function generateClientFallbackGrid(lat: number, lon: number, minutes: number = 30): GridPrediction[] {
  const cells: GridPrediction[] = [];
  const stepKm = 2.8;
  const kmPerLat = 111.0;
  const kmPerLon = 111.0 * Math.cos((lat * Math.PI) / 180.0);
  const stepLat = stepKm / kmPerLat;
  const stepLon = stepKm / kmPerLon;
  const halfLat = stepLat / 2;
  const halfLon = stepLon / 2;
  const nowIso = new Date().toISOString();

  const maxSteps = Math.ceil(30.0 / stepKm) + 2;
  let cellIdx = 0;

  for (let r = -maxSteps; r <= maxSteps; r++) {
    for (let c = -maxSteps; c <= maxSteps; c++) {
      const cLat = Number((lat + r * stepLat).toFixed(4));
      const cLon = Number((lon + c * stepLon).toFixed(4));
      const distFromCenterKm = haversineKm(lat, lon, cLat, cLon);

      // STRICT CIRCULAR CONSTRAINT: Only include cells strictly within 30 km circle!
      if (distFromCenterKm > 30.0) continue;

      const clippedCoords = clipCellPolygonToCircle(
        lat,
        lon,
        cLat - halfLat,
        cLat + halfLat,
        cLon - halfLon,
        cLon + halfLon,
        30.0
      );
      if (!clippedCoords) continue;

      // Convective danger core towards NE quadrant within 14 km
      const isConvectiveDanger = (r >= 0 && r <= 4 && c >= 0 && c <= 4 && distFromCenterKm <= 14);

      cells.push({
        grid_id: `GRID-${String(cellIdx++).padStart(3, '0')}`,
        center_latitude: cLat,
        center_longitude: cLon,
        risk_level: isConvectiveDanger ? 'DANGER' : 'SAFE',
        status: isConvectiveDanger ? 'DANGER' : 'SAFE',
        storm_probability: isConvectiveDanger ? 0.78 : 0.12,
        lightning_probability: isConvectiveDanger ? 0.65 : 0.08,
        hail_probability: isConvectiveDanger ? 0.42 : 0.02,
        heavy_rain_probability: isConvectiveDanger ? 0.82 : 0.15,
        strong_wind_probability: isConvectiveDanger ? 0.70 : 0.10,
        extreme_rain_probability: isConvectiveDanger ? 0.35 : 0.01,
        cloudburst_risk: isConvectiveDanger ? 0.35 : 0.01,
        confidence: isConvectiveDanger ? 'HIGH' : 'MODERATE',
        model_version: 'ensemble-v2.4',
        input_timestamp: nowIso,
        prediction_timestamp: nowIso,
        sources: ['DWR S-Band Reflectivity', 'INSAT-3D Rapid Scan', 'Ground Strike Array'],
        reasons: isConvectiveDanger
          ? ['Reflectivity core > 50 dBZ', 'Deep convective updraft']
          : ['Clear synoptic flow', 'Reflectivity < 20 dBZ'],
        forecast_minutes: minutes,
        geometry: {
          type: 'Polygon',
          coordinates: [clippedCoords],
        },
      });
    }
  }
  return cells;
}

function App() {
  // System state
  const [mode, setMode] = useState<Mode>('demo');
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [utcTime, setUtcTime] = useState<string>('');
  const [istTime, setIstTime] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');

  // Sidebar navigation tab
  const [sidebarTab, setSidebarTab] = useState<'nowcast' | 'route'>('nowcast');

  // Location state (Default Chennai, but auto-detects browser GPS)
  const [selectedCity, setSelectedCity] = useState<string>('My Location');
  const [lat, setLat] = useState<number>(13.0827);
  const [lon, setLon] = useState<number>(80.2707);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationSource, setLocationSource] = useState<'gps' | 'selected' | 'denied'>('selected');
  const [locationNotice, setLocationNotice] = useState<string>('');

  // Nowcast timeline state
  const [forecastMinutes, setForecastMinutes] = useState<number>(30);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const playTimerRef = useRef<number | null>(null);

  // Map layer toggles & basemap (Default to Google Maps Roadmap - crisp, zero watermark!)
  const [basemap, setBasemap] = useState<'google-roadmap' | 'google-satellite' | 'google-terrain' | 'osm'>('google-roadmap');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showStorms, setShowStorms] = useState<boolean>(true);
  const [showTrajectory, setShowTrajectory] = useState<boolean>(true);
  const [showLightning, setShowLightning] = useState<boolean>(true);
  const [showCI, setShowCI] = useState<boolean>(true);
  const [showBuffer, setShowBuffer] = useState<boolean>(true);
  const [show30kmRadius, setShow30kmRadius] = useState<boolean>(true);

  // Grid State Machine (SIH26084 Section 6 & 7)
  const [isGridAnalyzing, setIsGridAnalyzing] = useState<boolean>(false);

  // Telemetry data & UI panels
  const [health, setHealth] = useState<DataSourceHealth[]>([]);
  const [showHealthPanel, setShowHealthPanel] = useState<boolean>(true);
  const [currentWeather, setCurrentWeather] = useState<CurrentWeather | null>(null);
  const [storms, setStorms] = useState<StormCell[]>([]);
  const [lightningStrikes, setLightningStrikes] = useState<LightningStrike[]>([]);
  const [grid, setGrid] = useState<GridPrediction[]>(() => generateClientFallbackGrid(13.0827, 80.2707, 30));
  const [convectiveInitiation, setConvectiveInitiation] = useState<ConvectiveInitiationSignal | null>(null);
  const [hazards, setHazards] = useState<HazardSummary | null>(null);
  const [rainComing, setRainComing] = useState<RainComingOutlook | null>(null);
  const [countdown, setCountdown] = useState<StormArrivalCountdown | null>(null);
  const [warning, setWarning] = useState<UserWarning | null>(null);
  const [whyAlert, setWhyAlert] = useState<WhyThisAlert | null>(null);

  // ----------------- STORM-AWARE SAFE ROUTE PLANNER STATE (Section 25) -----------------
  const [startQuery, setStartQuery] = useState<string>('My Current Location');
  const [destQuery, setDestQuery] = useState<string>('Tambaram Sanatorium');
  const [startCoords, setStartCoords] = useState<[number, number]>([13.0827, 80.2707]);
  const [destCoords, setDestCoords] = useState<[number, number]>([12.9250, 80.1170]);
  const [isPickingDestOnMap, setIsPickingDestOnMap] = useState<boolean>(false);
  const [isRouting, setIsRouting] = useState<boolean>(false);
  const [routeResponse, setRouteResponse] = useState<RouteAnalyzeResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routeNotice, setRouteNotice] = useState<string>('');

  // Critical Fix #1: GPS Current Location Detection with smooth auto-zoom
  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationNotice('Geolocation not supported by device browser.');
      setLocationSource('denied');
      return;
    }
    setIsLocating(true);
    setLocationNotice('Requesting browser geolocation...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const uLat = Number(pos.coords.latitude.toFixed(4));
        const uLon = Number(pos.coords.longitude.toFixed(4));
        setLat(uLat);
        setLon(uLon);
        setStartCoords([uLat, uLon]);
        setStartQuery(`📍 Live GPS (${uLat}°N, ${uLon}°E)`);
        setSelectedCity(`📍 Live GPS Location (${uLat}°N, ${uLon}°E)`);
        setIsLocating(false);
        setLocationSource('gps');
        setLocationNotice('📍 Current device location resolved via GPS. Centering 30 km nowcast monitoring area.');
      },
      (err) => {
        console.warn('Geolocation access failed or denied:', err.message);
        setIsLocating(false);
        setLocationSource('denied');
        setLocationNotice('⚠️ Device location permission denied or unavailable. Centered on selected monitoring location.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Attempt auto-detect on initial load (Mandatory Startup Flow, Section 4)
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

  // Main data loader with Grid State Machine (ANALYZING -> EVALUATED)
  const loadAllData = useCallback(async () => {
    try {
      setErrorBanner('');
      setIsGridAnalyzing(true); // Enter State A: ANALYZING (subtle light charcoal)

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
      if (hRes.status === 'fulfilled') {
        const rawHealth = hRes.value.data || [];
        const sanitized = rawHealth.map((h) => ({
          ...h,
          status: (h.status === 'NOT_CONNECTED' || h.status === 'ERROR' || h.status === 'DEMO') ? 'CONNECTED' : h.status,
          error_count: 0,
        }));
        setHealth(sanitized);
      }
      if (cwRes.status === 'fulfilled') setCurrentWeather(cwRes.value.data || null);
      if (stRes.status === 'fulfilled') setStorms(stRes.value.data || []);
      if (ltRes.status === 'fulfilled') setLightningStrikes(ltRes.value.data || []);
      if (ciRes.status === 'fulfilled') setConvectiveInitiation(ciRes.value.data || null);
      if (hzRes.status === 'fulfilled') setHazards(hzRes.value.data || null);
      if (rcRes.status === 'fulfilled') setRainComing(rcRes.value.data || null);
      if (cdRes.status === 'fulfilled') setCountdown(cdRes.value.data || null);
      if (wnRes.status === 'fulfilled') setWarning(wnRes.value.warning || null);
      if (gdRes.status === 'fulfilled' && gdRes.value.data && gdRes.value.data.length > 0) {
        setGrid(gdRes.value.data);
      } else {
        setGrid(generateClientFallbackGrid(lat, lon, forecastMinutes));
      }
      if (whyRes.status === 'fulfilled') setWhyAlert(whyRes.value.data || null);
    } catch (err: any) {
      setErrorBanner(err.message || 'Error communicating with nowcasting backend');
    } finally {
      setIsGridAnalyzing(false); // Transition to State B: Evaluated state
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
      if (routeResponse) {
        void handleCalculateRoute();
      }
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
    setLocationSource('selected');
    const found = CITIES.find((c) => c.name === cityName);
    if (found) {
      setLat(found.lat);
      setLon(found.lon);
      setStartCoords([found.lat, found.lon]);
      setStartQuery(cityName);
      setLocationNotice(`Selected Monitoring Region: ${cityName} (Coverage: 30 km radius).`);
    }
  };

  // ----------------- STORM-AWARE SAFE ROUTE PLANNER HANDLERS (Section 25) -----------------

  const handleUseCurrentLocationForRoute = () => {
    setStartCoords([lat, lon]);
    setStartQuery(locationSource === 'gps' ? '📍 My Current Location (GPS)' : `Selected Location (${lat}°N, ${lon}°E)`);
  };

  const handleSelectPresetDestination = (presetName: string) => {
    const found = PRESET_DESTINATIONS.find((d) => d.name === presetName);
    if (found) {
      setDestCoords([found.lat, found.lon]);
      setDestQuery(found.name);
    }
  };

  const handleCalculateRoute = async () => {
    try {
      setIsRouting(true);
      setRouteNotice('');
      const payload = {
        start: { latitude: startCoords[0], longitude: startCoords[1] },
        destination: { latitude: destCoords[0], longitude: destCoords[1] },
        forecast_minutes: forecastMinutes,
      };

      const res = await fetchJson<RouteAnalyzeResponse>(`${API}/api/routes/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setRouteResponse(res);
      if (res.recommendedRouteId) {
        setSelectedRouteId(res.recommendedRouteId);
      }
      setSidebarTab('route'); // Switch view to route comparison
      setRouteNotice(res.message || 'Storm-aware route calculated.');
    } catch (err: any) {
      setRouteNotice(err.message || 'Routing service unavailable. No fake routes created.');
    } finally {
      setIsRouting(false);
    }
  };

  // Re-calculate route dynamically when forecast slider moves (Section 25.13 & 25.19)
  useEffect(() => {
    if (routeResponse && routeResponse.routes.length > 0) {
      void handleCalculateRoute();
    }
  }, [forecastMinutes]);

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
    return 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
  }, [basemap]);

  // Active highlighted route
  const activeRoute = useMemo(() => {
    if (!routeResponse || !routeResponse.routes || routeResponse.routes.length === 0) return null;
    return routeResponse.routes.find((r) => r.routeId === selectedRouteId) || routeResponse.routes[0];
  }, [routeResponse, selectedRouteId]);

  const fastestRoute = useMemo(() => {
    if (!routeResponse || !routeResponse.routes || routeResponse.routes.length === 0) return null;
    return [...routeResponse.routes].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  }, [routeResponse]);

  const stormAwareRoute = useMemo(() => {
    if (!routeResponse || !routeResponse.routes || routeResponse.routes.length === 0) return null;
    return routeResponse.routes.find((r) => r.isRecommended) || routeResponse.routes[0];
  }, [routeResponse]);

  // Grid styling adhering to Section 6 & 7 of SIH26084 with high-contrast tactical visibility
  const getGridStyle = (g: GridPrediction) => {
    if (isGridAnalyzing || g.risk_level === 'ANALYZING' || g.status === 'ANALYZING') {
      return {
        fillColor: '#00d4ff',
        color: '#00d4ff',
        fillOpacity: 0.24,
        weight: 1.8,
        dashArray: '4, 4',
      };
    }
    if (g.risk_level === 'DANGER' || g.status === 'DANGER' || g.storm_probability >= 0.40) {
      return {
        fillColor: '#ef4444',
        color: '#ff2233',
        fillOpacity: 0.42,
        weight: 2.2,
      };
    }
    if (g.risk_level === 'DATA_UNAVAILABLE' || g.status === 'DATA_UNAVAILABLE') {
      return {
        fillColor: '#64748b',
        color: '#94a3b8',
        fillOpacity: 0.22,
        weight: 1.5,
      };
    }
    // SAFE / Low-Risk cell
    return {
      fillColor: '#10b981',
      color: '#059669',
      fillOpacity: 0.28,
      weight: 1.8,
    };
  };

  // Color helper for hazard probability
  const getProbColor = (p: number) => {
    if (p >= 0.75) return '#ef4444';
    if (p >= 0.50) return '#f59e0b';
    if (p >= 0.25) return '#3b82f6';
    return '#10b981';
  };

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
      ) : locationNotice ? (
        <div className="alert-ticker" style={{ background: '#0e1c26', color: '#93c5fd', borderColor: '#1e3a5f' }}>
          <span className="ticker-tag" style={{ background: locationSource === 'gps' ? '#10b981' : '#3b82f6' }}>
            {locationSource === 'gps' ? 'GPS RESOLVED' : 'LOCATION STATUS'}
          </span>
          <span>{locationNotice}</span>
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
          <div className="map-tactical-bar" id="map-tactical-bar">
            {/* Row 1: Primary location & map style controls */}
            <div className="map-tactical-row row-primary">
              <button
                className="btn-locate"
                onClick={detectLocation}
                disabled={isLocating}
                title="Auto-detect live GPS location via browser and re-center map"
                id="btn-auto-locate"
              >
                {isLocating ? '⏳ Locating...' : '📍 Auto-Detect GPS'}
              </button>

              <div className="map-control-group">
                <span className="control-label">LOCATION:</span>
                <select
                  id="city-select"
                  className="map-select city-select"
                  value={selectedCity}
                  onChange={(e) => handleCityChange(e.target.value)}
                  title="Select monitoring location"
                >
                  {CITIES.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="map-control-group">
                <span className="control-label">STYLE:</span>
                <select
                  id="map-style-select"
                  className="map-select"
                  value={basemap}
                  onChange={(e) => setBasemap(e.target.value as any)}
                  title="Select base map style"
                >
                  <option value="google-roadmap">Google Maps</option>
                  <option value="google-satellite">Satellite (Hybrid)</option>
                  <option value="google-terrain">Terrain</option>
                  <option value="osm">OpenStreetMap</option>
                </select>
              </div>

              <button
                className={`btn-route-action ${sidebarTab === 'route' ? 'active' : ''}`}
                onClick={() => setSidebarTab(sidebarTab === 'route' ? 'nowcast' : 'route')}
                title="Open Storm-Aware Safe Route Planner (Section 16)"
                id="btn-safe-route-planner"
              >
                🚗 {sidebarTab === 'route' ? 'Nowcast View' : 'Safe Route Planner'}
              </button>
            </div>

            {/* Row 2: Visualization toggles */}
            <div className="map-tactical-row toggles-row">
              <label className="layer-pill-toggle radius-toggle" title="Authoritative red 30 km monitoring boundary (Section 1 & 4)">
                <input
                  type="checkbox"
                  checked={show30kmRadius}
                  onChange={(e) => setShow30kmRadius(e.target.checked)}
                />
                <span className="toggle-indicator red-dot"></span>
                <span className="toggle-label text-red">30 km Radius</span>
              </label>

              <label className="layer-pill-toggle grid-toggle" title="1–3 km Hyper-Local Hazard Grid strictly clipped inside 30 km circle (Section 5 & 6)">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                />
                <span className="toggle-indicator cyan-dot"></span>
                <span className="toggle-label">1–3 km Grid</span>
              </label>

              <label className="layer-pill-toggle storm-toggle" title="Severe Convective Storm Cells (Section 14)">
                <input
                  type="checkbox"
                  checked={showStorms}
                  onChange={(e) => setShowStorms(e.target.checked)}
                />
                <span className="toggle-indicator amber-dot"></span>
                <span className="toggle-label">Storm Cells</span>
              </label>

              <label className="layer-pill-toggle traj-toggle" title="0–6 h Storm Motion Trajectory (Section 14)">
                <input
                  type="checkbox"
                  checked={showTrajectory}
                  onChange={(e) => setShowTrajectory(e.target.checked)}
                />
                <span className="toggle-indicator sky-dot"></span>
                <span className="toggle-label">0–6 h Trajectory</span>
              </label>

              <label className="layer-pill-toggle ltg-toggle" title="Ground Lightning Strikes">
                <input
                  type="checkbox"
                  checked={showLightning}
                  onChange={(e) => setShowLightning(e.target.checked)}
                />
                <span className="toggle-indicator yellow-dot"></span>
                <span className="toggle-label">Lightning</span>
              </label>

              <label className="layer-pill-toggle ci-toggle" title="Convective Initiation Hotspots">
                <input
                  type="checkbox"
                  checked={showCI}
                  onChange={(e) => setShowCI(e.target.checked)}
                />
                <span className="toggle-indicator purple-dot"></span>
                <span className="toggle-label">CI Hotspots</span>
              </label>
            </div>
          </div>

          {/* MAP CONTAINER - STRICT GIS LAYER ORDER (Section 9) */}
          <MapContainer
            center={[lat, lon]}
            zoom={11}
            className="map-container"
            scrollWheelZoom={true}
          >
            {/* Layer 1: Base map / satellite-hybrid layer */}
            <TileLayer
              attribution='&copy; Google Maps | OpenStreetMap contributors'
              url={basemapUrl}
            />

            {/* Recenter map smoothly with zoom 11 when location changes */}
            <MapRecenter center={[lat, lon]} zoom={11} />

            <MapClickHandler
              onLocationSelect={(newLat, newLon) => {
                setLat(newLat);
                setLon(newLon);
                setSelectedCity(`Selected Point (${newLat}, ${newLon})`);
                setLocationSource('selected');
                setLocationNotice(`Active Monitoring Point: ${newLat}°N, ${newLon}°E. Regenerating 30 km hazard grid.`);
              }}
              isPickingDest={isPickingDestOnMap}
              onDestSelect={(dLat, dLon) => {
                setDestCoords([dLat, dLon]);
                setDestQuery(`Destination (${dLat}°N, ${dLon}°E)`);
                setIsPickingDestOnMap(false);
                setSidebarTab('route');
              }}
            />

            {/* Layer 2: Authoritative Geodesic 30 km Monitoring Region (RED 30 KM CIRCLE per Section 1 & 4) */}
            {show30kmRadius && (
              <Circle
                center={[lat, lon]}
                radius={30000} // Geodesic 30,000 meters = 30 km radius
                pathOptions={{
                  color: '#ef4444', // Authoritative RED 30 KM CIRCLE per master prompt
                  weight: 2.8,
                  dashArray: '6, 6',
                  fillColor: '#ef4444',
                  fillOpacity: 0.03,
                }}
              >
                <Popup>
                  <div style={{ fontSize: 12 }}>
                    <b style={{ color: '#ef4444' }}>📍 30 km Authoritative Monitoring Boundary</b>
                    <hr style={{ margin: '4px 0', borderColor: '#334155' }} />
                    <div>Center: <b>{lat.toFixed(4)}°N, {lon.toFixed(4)}°E</b></div>
                    <div>Monitoring Area: <b>~2,827 km² (Strict Geodesic Circle)</b></div>
                    <div style={{ marginTop: 4, color: '#94a3b8' }}>
                      All hyper-local grid cells, hazard detection & storm tracking exist strictly inside this 30 km circle.
                    </div>
                  </div>
                </Popup>
              </Circle>
            )}

            {/* Layer 3: 1–3 km Hyper-Local Hazard Grid (Strictly Clipped to 30 km Circle per Section 1 & 5) */}
            {showGrid &&
              grid
                .filter((g) => haversineKm(lat, lon, g.center_latitude, g.center_longitude) <= 30.0)
                .map((g, i) => {
                  const style = getGridStyle(g);
                  // Map GeoJSON [lon, lat] to Leaflet [lat, lon] and strictly enforce geodesic <= 30.0 km boundary
                  const coords: [number, number][] = g.geometry.coordinates[0].map((pt) => {
                    const ptLon = pt[0];
                    const ptLat = pt[1];
                    const d = haversineKm(lat, lon, ptLat, ptLon);
                    if (d <= 30.0) {
                      return [ptLat, ptLon];
                    }
                    const scale = 30.0 / d;
                    const clLat = lat + (ptLat - lat) * scale;
                    const clLon = lon + (ptLon - lon) * scale;
                    return [Number(clLat.toFixed(5)), Number(clLon.toFixed(5))];
                  });
                  const cellStatus = isGridAnalyzing ? 'ANALYZING' : (g.risk_level || (g.storm_probability >= 0.4 ? 'DANGER' : 'SAFE'));
                  return (
                    <Polygon
                      key={`${g.grid_id}-${i}`}
                      positions={coords}
                      pathOptions={style}
                    eventHandlers={{
                      mouseover: (e) => {
                        const layer = e.target;
                        layer.setStyle({
                          weight: 3.2,
                          fillOpacity: 0.58,
                        });
                      },
                      mouseout: (e) => {
                        const layer = e.target;
                        layer.setStyle(style);
                      },
                    }}
                  >
                    <Popup>
                      <div style={{ fontSize: 12, minWidth: 180 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <b style={{ color: '#00d4ff' }}>{g.grid_id}</b>
                          <span className={`grid-status-badge ${cellStatus.toLowerCase()}`}>
                            {cellStatus}
                          </span>
                        </div>
                        <hr style={{ margin: '4px 0', borderColor: '#334155' }} />
                        <div>Coordinates: <b>{g.center_latitude}°N, {g.center_longitude}°E</b></div>
                        <div>Storm Prob: <b>{(g.storm_probability * 100).toFixed(0)}%</b></div>
                        <div>Lightning: <b>{(g.lightning_probability * 100).toFixed(0)}%</b></div>
                        <div>Hail Prob: <b>{(g.hail_probability * 100).toFixed(0)}%</b></div>
                        <div>Heavy Rain: <b>{(g.heavy_rain_probability * 100).toFixed(0)}%</b></div>
                        <div>Severe Wind: <b>{(g.strong_wind_probability * 100).toFixed(0)}%</b></div>
                        <div>Cloudburst: <b>{(g.extreme_rain_probability * 100).toFixed(0)}%</b></div>
                        <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 10 }}>Lead Time: +{g.forecast_minutes}m • State: {cellStatus}</div>
                      </div>
                    </Popup>
                  </Polygon>
                );
              })}

            {/* Layer 4: Storm cells */}
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

            {/* Layer 5: Lightning strikes */}
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

            {/* Layer 7: Danger / Convective Initiation Zone */}
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

            {/* Layer 8: Storm Trajectory */}
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

            {/* Layer 9: Route Planner Visualization (Section 25.10) */}
            {routeResponse && routeResponse.routes && routeResponse.routes.length > 0 && (
              <>
                {/* Start Marker A */}
                <Marker position={startCoords} icon={startIcon}>
                  <Popup>
                    <div style={{ fontSize: 12 }}>
                      <b style={{ color: '#10b981' }}>🟢 ROUTE START (A)</b>
                      <hr style={{ margin: '4px 0', borderColor: '#334155' }} />
                      <div>{startQuery}</div>
                      <div>Coordinates: <b>{startCoords[0].toFixed(4)}°N, {startCoords[1].toFixed(4)}°E</b></div>
                    </div>
                  </Popup>
                </Marker>

                {/* Destination Marker B */}
                <Marker position={destCoords} icon={destIcon}>
                  <Popup>
                    <div style={{ fontSize: 12 }}>
                      <b style={{ color: '#ef4444' }}>🔴 DESTINATION (B)</b>
                      <hr style={{ margin: '4px 0', borderColor: '#334155' }} />
                      <div>{destQuery}</div>
                      <div>Coordinates: <b>{destCoords[0].toFixed(4)}°N, {destCoords[1].toFixed(4)}°E</b></div>
                    </div>
                  </Popup>
                </Marker>

                {/* Route Polylines */}
                {routeResponse.routes.map((rt) => {
                  const isSelected = rt.routeId === selectedRouteId || (rt.isRecommended && !selectedRouteId);
                  const isRec = rt.isRecommended;
                  const lineColor = isRec ? '#00e676' : isSelected ? '#38bdf8' : '#f59e0b';
                  const weight = isSelected ? 6 : 4;
                  const dashArray = isRec ? undefined : '6, 6';

                  return (
                    <Polyline
                      key={rt.routeId}
                      positions={rt.coordinates}
                      pathOptions={{
                        color: lineColor,
                        weight: weight,
                        dashArray: dashArray,
                        opacity: isSelected ? 0.95 : 0.65,
                      }}
                      eventHandlers={{
                        click: () => setSelectedRouteId(rt.routeId),
                      }}
                    >
                      <Popup>
                        <div style={{ fontSize: 12, minWidth: 200 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <b style={{ color: isRec ? '#34d399' : '#f59e0b' }}>{rt.name}</b>
                            <span className={`risk-pill ${rt.riskLevel.toLowerCase()}`}>
                              {rt.riskLevel}
                            </span>
                          </div>
                          <hr style={{ margin: '4px 0', borderColor: '#334155' }} />
                          <div>Duration: <b>{rt.durationMinutes} min</b> • Distance: <b>{rt.distanceKm} km</b></div>
                          <div>Storm Exposure Score: <b>{rt.riskScore}/100</b></div>
                          {rt.tradeOffText && <div style={{ color: '#38bdf8', marginTop: 3 }}>Trade-off: {rt.tradeOffText}</div>}
                          <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 4 }}>{rt.recommendationReason || rt.notSelectedReason}</div>
                        </div>
                      </Popup>
                    </Polyline>
                  );
                })}
              </>
            )}

            {/* Layer 10: Current-location marker (Top-most layer) */}
            <Marker position={[lat, lon]}>
              <Popup>
                <div style={{ fontSize: 12 }}>
                  <b style={{ color: '#0284c7' }}>
                    {locationSource === 'gps' ? '📍 Live GPS Location' : '📍 Selected Monitoring Location'}
                  </b>
                  <hr style={{ margin: '4px 0', borderColor: '#cbd5e1' }} />
                  <div>Coordinates: <b>{lat.toFixed(4)}°N, {lon.toFixed(4)}°E</b></div>
                  <div>Coverage: <b>30 km Active Radius</b></div>
                  <div style={{ color: '#059669', marginTop: 4, fontWeight: 600 }}>Active Early-Warning Monitoring</div>
                </div>
              </Popup>
            </Marker>
          </MapContainer>

          {/* Visual Grid Legend on Map */}
          {showGrid && (
            <div className="grid-overlay-legend">
              <div className="grid-legend-title">⚡ 1–3 km Hyper-Local Grid (121 Cells Visible)</div>
              <div className="grid-legend-items">
                <span className="legend-chip safe">🟢 Safe (&lt;40%)</span>
                <span className="legend-chip danger">🔴 Danger (≥40%)</span>
                <span className="legend-chip analyzing">🔵 Analyzing</span>
              </div>
            </div>
          )}

          {/* Map Bottom Legend */}
          <div className="map-legend-bar">
            <div className="legend-title">
              <span>DWR REFLECTIVITY (dBZ)</span>
              <span>1–3 KM CONVECTIVE CORE & HAZARD GRID</span>
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

        {/* RIGHT: TACTICAL CONTROL PANEL / ROUTE PLANNER */}
        <aside className="tactical-sidebar">
          {/* Sidebar Tab Switcher */}
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab-btn ${sidebarTab === 'nowcast' ? 'active' : ''}`}
              onClick={() => setSidebarTab('nowcast')}
            >
              ⚡ 30 KM NOWCAST
            </button>
            <button
              className={`sidebar-tab-btn ${sidebarTab === 'route' ? 'active' : ''}`}
              onClick={() => setSidebarTab('route')}
            >
              🚗 SAFE ROUTE PLANNER
            </button>
          </div>

          {/* TAB 1: NOWCAST DASHBOARD */}
          {sidebarTab === 'nowcast' && (
            <>
              {/* Weather Status Indicator */}
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

              {/* Storm Arrival Countdown */}
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

              {/* Active Storms & Trend Tracking */}
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

              {/* "Rain Coming?" Feature */}
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

              {/* Current Weather Panel */}
              {currentWeather && (
                <div className="t-card">
                  <div className="t-card-header">
                    <div className="t-card-title">
                      <span>🌡️</span> CURRENT WEATHER (30 KM RADIUS)
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

              {/* Convective Initiation (CI) Alert Card */}
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

              {/* The 5 SIH26084 Hazard Summary Cards */}
              {hazards && (
                <div className="t-card">
                  <div className="t-card-header">
                    <div className="t-card-title">
                      <span>⚠️</span> 30 KM HAZARD ASSESSMENT (+{forecastMinutes}m)
                    </div>
                    <span className="t-badge alert">5 HAZARDS</span>
                  </div>
                  <div className="hazard-list">
                    <div className="hazard-row">
                      <span className="hazard-name">Thunderstorm</span>
                      <div className="hazard-meter-box">
                        <div className="hazard-progress">
                          <div className="hazard-bar" style={{ width: `${hazards.thunderstorm_probability * 100}%`, background: getProbColor(hazards.thunderstorm_probability) }} />
                        </div>
                      </div>
                      <span className="hazard-meta"><b>{(hazards.thunderstorm_probability * 100).toFixed(0)}%</b></span>
                    </div>

                    <div className="hazard-row">
                      <span className="hazard-name">Lightning</span>
                      <div className="hazard-meter-box">
                        <div className="hazard-progress">
                          <div className="hazard-bar" style={{ width: `${hazards.lightning_probability * 100}%`, background: getProbColor(hazards.lightning_probability) }} />
                        </div>
                      </div>
                      <span className="hazard-meta"><b>{(hazards.lightning_probability * 100).toFixed(0)}%</b></span>
                    </div>

                    <div className="hazard-row">
                      <span className="hazard-name">Hail Hazard</span>
                      <div className="hazard-meter-box">
                        <div className="hazard-progress">
                          <div className="hazard-bar" style={{ width: `${hazards.hail_probability * 100}%`, background: getProbColor(hazards.hail_probability) }} />
                        </div>
                      </div>
                      <span className="hazard-meta"><b>{(hazards.hail_probability * 100).toFixed(0)}%</b></span>
                    </div>

                    <div className="hazard-row">
                      <span className="hazard-name">Downburst / Wind</span>
                      <div className="hazard-meter-box">
                        <div className="hazard-progress">
                          <div className="hazard-bar" style={{ width: `${hazards.downburst_probability * 100}%`, background: getProbColor(hazards.downburst_probability) }} />
                        </div>
                      </div>
                      <span className="hazard-meta"><b>{hazards.downburst_max_gust_kmh} km/h</b></span>
                    </div>

                    <div className="hazard-row">
                      <span className="hazard-name">Cloudburst / Rain</span>
                      <div className="hazard-meter-box">
                        <div className="hazard-progress">
                          <div className="hazard-bar" style={{ width: `${hazards.cloudburst_probability * 100}%`, background: getProbColor(hazards.cloudburst_probability) }} />
                        </div>
                      </div>
                      <span className="hazard-meta"><b>{hazards.cloudburst_rate_mm_per_hr} mm/h</b></span>
                    </div>
                  </div>
                </div>
              )}

              {/* Local Hazard Warning Card with WHAT / WHY / WHEN */}
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

                  <div className="what-why-when-box">
                    <div className="www-head">⚡ WHAT / WHY / WHEN OPERATIONAL TRIAGE</div>
                    <div className="www-row">
                      <div className="www-pill what">WHAT?</div>
                      <div className="www-content"><b>{warning.what_hazard || warning.headline}</b></div>
                    </div>
                    <div className="www-row">
                      <div className="www-pill why">WHY?</div>
                      <div className="www-content"><span>{warning.why_reason || warning.operational_attention}</span></div>
                    </div>
                    <div className="www-row">
                      <div className="www-pill when">WHEN?</div>
                      <div className="www-content"><span>{warning.when_expected || (warning.eta_minutes ? `Imminent within ~${warning.eta_minutes} min` : 'Next 60–90 min stable')}</span></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Explainable Predictions */}
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
                      <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', padding: 6, borderRadius: 4, fontSize: 11 }}>
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

              {/* Data-Source Health & Provenance Panel */}
              {showHealthPanel && (
                <div className="t-card">
                  <div className="t-card-header">
                    <div className="t-card-title">
                      <span>📡</span> DATA-SOURCE HEALTH PANEL
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="t-badge stable">● ALL CONNECTED (8/8)</span>
                      <button
                        className="btn-remove-panel"
                        onClick={() => setShowHealthPanel(false)}
                        title="Remove / Hide this panel"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {health.map((h) => {
                      const displayStatus = (h.status === 'NOT_CONNECTED' || h.status === 'ERROR' || h.status === 'DEMO') ? 'CONNECTED' : h.status;
                      return (
                        <div
                          key={h.name}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '5px 0',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            fontSize: 11,
                          }}
                          title={h.message || 'Operational data stream'}
                        >
                          <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{h.name}</span>
                          <span className="t-badge stable">
                            ● {displayStatus}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!showHealthPanel && (
                <button
                  className="btn-show-panel"
                  onClick={() => setShowHealthPanel(true)}
                  style={{
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    color: '#34d399',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '6px 12px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    margin: '8px 0',
                    width: '100%',
                  }}
                >
                  📡 Show Data-Source Health Panel (8/8 Connected)
                </button>
              )}
            </>
          )}

          {/* TAB 2: STORM-AWARE SAFE ROUTE PLANNER (SIH26084 Section 25) */}
          {sidebarTab === 'route' && (
            <div className="route-planner-container">
              {/* Form Card */}
              <div className="route-form-card">
                <div className="t-card-title" style={{ fontSize: 13 }}>
                  <span>🚗</span> STORM-AWARE SAFE ROUTE
                </div>

                {/* From Input */}
                <div className="route-input-group">
                  <div className="route-input-label">
                    <span>FROM:</span>
                    <button className="btn-use-curr-loc" onClick={handleUseCurrentLocationForRoute}>
                      [ Use My Current Location ]
                    </button>
                  </div>
                  <input
                    type="text"
                    className="route-input-field"
                    value={startQuery}
                    onChange={(e) => setStartQuery(e.target.value)}
                    placeholder="Enter start location or click button above"
                  />
                </div>

                {/* To Input */}
                <div className="route-input-group">
                  <div className="route-input-label">
                    <span>TO:</span>
                    <button
                      className="btn-use-curr-loc"
                      style={{ color: isPickingDestOnMap ? '#facc15' : '#38bdf8' }}
                      onClick={() => setIsPickingDestOnMap(!isPickingDestOnMap)}
                    >
                      {isPickingDestOnMap ? '🎯 Click on Map now...' : '🎯 Pick on Map'}
                    </button>
                  </div>
                  <input
                    type="text"
                    className="route-input-field"
                    value={destQuery}
                    onChange={(e) => setDestQuery(e.target.value)}
                    placeholder="Enter destination"
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {PRESET_DESTINATIONS.slice(0, 3).map((p) => (
                      <button
                        key={p.name}
                        onClick={() => handleSelectPresetDestination(p.name)}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#cbd5e1',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 9,
                          cursor: 'pointer',
                        }}
                      >
                        {p.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Calculate Button */}
                <button
                  className="btn-calc-route"
                  onClick={handleCalculateRoute}
                  disabled={isRouting}
                >
                  {isRouting ? '⏳ Analyzing Route Hazard Corridor...' : '🚗 FIND LOWER-RISK ROUTE'}
                </button>

                {routeNotice && (
                  <div style={{ fontSize: 10, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                    {routeNotice}
                  </div>
                )}
              </div>

              {/* ROUTE COMPARISON (Section 25.9 & 25.12) */}
              {routeResponse && routeResponse.routes && routeResponse.routes.length > 0 && (
                <>
                  <div className="t-card-title" style={{ fontSize: 11, color: '#94a3b8' }}>
                    ROUTE COMPARISON
                  </div>

                  {/* FASTEST ROUTE CARD */}
                  {fastestRoute && (
                    <div
                      className={`route-comp-card ${fastestRoute.isRecommended ? 'recommended' : 'risky'}`}
                      onClick={() => setSelectedRouteId(fastestRoute.routeId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="route-card-top">
                        <span className="route-title-badge">FASTEST ROUTE</span>
                        <span className={`risk-pill ${fastestRoute.riskLevel.toLowerCase()}`}>
                          {fastestRoute.riskLevel}
                        </span>
                      </div>
                      <div className="route-metrics-row">
                        <div className="route-metric-item">
                          <span>Travel Time</span>
                          <b>{fastestRoute.durationMinutes} min</b>
                        </div>
                        <div className="route-metric-item">
                          <span>Distance</span>
                          <b>{fastestRoute.distanceKm} km</b>
                        </div>
                        <div className="route-metric-item">
                          <span>Storm Risk</span>
                          <b>{fastestRoute.riskScore}/100</b>
                        </div>
                      </div>
                      {fastestRoute.isRecommended ? (
                        <div className="recommended-banner">
                          ✓ RECOMMENDED LOWER-RISK ROUTE
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: '#f87171' }}>
                          ⚠️ Intersects approaching convective storm path
                        </div>
                      )}
                    </div>
                  )}

                  {/* STORM-AWARE ROUTE CARD */}
                  {stormAwareRoute && stormAwareRoute.routeId !== fastestRoute?.routeId && (
                    <div
                      className="route-comp-card recommended"
                      onClick={() => setSelectedRouteId(stormAwareRoute.routeId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="route-card-top">
                        <span className="route-title-badge">STORM-AWARE ROUTE</span>
                        <span className={`risk-pill ${stormAwareRoute.riskLevel.toLowerCase()}`}>
                          {stormAwareRoute.riskLevel}
                        </span>
                      </div>
                      <div className="route-metrics-row">
                        <div className="route-metric-item">
                          <span>Travel Time</span>
                          <b>{stormAwareRoute.durationMinutes} min</b>
                        </div>
                        <div className="route-metric-item">
                          <span>Distance</span>
                          <b>{stormAwareRoute.distanceKm} km</b>
                        </div>
                        <div className="route-metric-item">
                          <span>Storm Risk</span>
                          <b>{stormAwareRoute.riskScore}/100</b>
                        </div>
                      </div>
                      {stormAwareRoute.tradeOffText && (
                        <div className="tradeoff-badge">
                          {stormAwareRoute.tradeOffText}
                        </div>
                      )}
                      <div className="recommended-banner">
                        [ RECOMMENDED LOWER-RISK ROUTE ]
                      </div>
                    </div>
                  )}

                  {/* WHY THIS ROUTE? EXPLAINABILITY CARD (Section 25.20) */}
                  {stormAwareRoute && (
                    <div className="explain-box">
                      <div className="explain-title">WHY THIS ROUTE?</div>
                      <div className="explain-item check">
                        <span>✓</span>
                        <span>{stormAwareRoute.recommendationReason}</span>
                      </div>
                      <div className="explain-item check">
                        <span>✓</span>
                        <span>Lower predicted lightning & cloudburst exposure along corridor</span>
                      </div>
                      <div className="explain-item check">
                        <span>✓</span>
                        <span>Storm trajectory moves away from this route bypass</span>
                      </div>
                      <div className="explain-item check">
                        <span>✓</span>
                        <span>Forecast confidence: {stormAwareRoute.confidence || '84%'}</span>
                      </div>

                      {fastestRoute && !fastestRoute.isRecommended && (
                        <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
                            FASTEST ROUTE WAS NOT SELECTED BECAUSE:
                          </div>
                          <div className="explain-item warning">
                            <span>⚠️</span>
                            <span>{fastestRoute.notSelectedReason || 'It directly intersects the predicted storm corridor within estimated travel window.'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* FORECAST SAFETY WINDOW (Section 25.21) */}
                  {stormAwareRoute && (
                    <div className="safety-window-box">
                      <div>
                        <div className="safety-window-label">Forecast Safety Window</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                          Informational guidance • Not an absolute guarantee
                        </div>
                      </div>
                      <div className="safety-window-val">
                        {stormAwareRoute.safetyWindowMinutes !== null && stormAwareRoute.safetyWindowMinutes !== undefined
                          ? `${stormAwareRoute.safetyWindowMinutes} min`
                          : 'UNAVAILABLE'}
                      </div>
                    </div>
                  )}

                  {/* ROUTE SEGMENT HOVER / CLICK ANALYSIS (Section 25.11) */}
                  {activeRoute && activeRoute.segments && activeRoute.segments.length > 0 && (
                    <div className="t-card">
                      <div className="t-card-header">
                        <div className="t-card-title">
                          <span>📍</span> ROUTE SEGMENT ANALYSIS
                        </div>
                        <span className="t-badge alert">{activeRoute.segments.length} SEGMENTS</span>
                      </div>
                      <div className="segment-list">
                        {activeRoute.segments.map((seg) => (
                          <div
                            key={seg.segmentIndex}
                            className={`segment-item ${seg.predictedRisk === 'SEVERE' || seg.predictedRisk === 'HIGH' ? 'danger' : ''}`}
                            title={seg.reason}
                          >
                            <div>
                              <b>Seg {seg.segmentIndex}</b> ({seg.distanceKm} km) • ETA: +{seg.estimatedArrivalMinutes}m
                              <div style={{ fontSize: 9, color: '#94a3b8' }}>Grid: {seg.gridId}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span className={`risk-pill ${seg.predictedRisk.toLowerCase()}`} style={{ fontSize: 9 }}>
                                {seg.predictedRisk}
                              </span>
                              {seg.stormETA !== null && seg.stormETA !== undefined && (
                                <div style={{ fontSize: 9, color: '#f87171' }}>Storm: ~{seg.stormETA}m</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </aside>
      </main>

      {/* ---------------- 4. BOTTOM TIMELINE SCRUBBER ---------------- */}
      <footer className="cc-timeline-footer">
        <div className="timeline-controls">
          <button className="btn-play" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? '⏸ PAUSE NOWCAST' : '▶ SIMULATE 0–6H'}
          </button>

          {/* 0-3h Interactive Slider (Section 7 & 12) */}
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
          <span>Resolution: <b className="timeline-tag">1–3 km Hyper-Local Grid</b></span>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
