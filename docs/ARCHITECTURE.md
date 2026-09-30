# Architecture

```text
IMD APIs ─────────────┐
MOSDAC/INSAT ─────────┤
Authorized Radar ─────┤→ adapters → validation/QC → normalization → storage
Authorized Lightning ─┤                                      ↓
Ground observations ─┘                           feature engineering
                                                         ↓
                                         baseline / trained ML inference
                                                         ↓
                                  storm detection → tracking → ETA → hazards
                                                         ↓
                               3 km grid → alert engine → FastAPI/WebSocket
                                                         ↓
                                               React GIS dashboard
```

REAL MODE never fills missing live feeds with random values. DEMO mode is an explicit simulation path.
