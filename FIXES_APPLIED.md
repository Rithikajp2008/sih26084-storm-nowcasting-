# Fixes Applied — v0.2.0

- Fixed ETA=0 handling in API and frontend.
- Replaced distance/speed ETA with direction-aware constant-velocity footprint intersection.
- Added storm-footprint radius derived from cell area and 3 km warning buffer.
- Added storm advection to demo forecast grid using speed and bearing.
- Added lead-time probability decay for demo forecast.
- Added frontend WebSocket live connection, reconnect logic, and last-update display.
- Added API error handling and visible frontend error banner.
- Added coordinate validation for user-warning endpoint.
- Added meaningful demo-mode health statuses instead of probing unavailable external feeds.
- Added demo alert generation from configured threshold logic.
- Removed duplicate Pydantic Settings config declaration.
- Pinned frontend dependency versions and added TypeScript typecheck to build.
- Expanded automated tests from 1 to 9, including API, ETA, advection, invalid coordinates, and WebSocket.
- Included a safe `.env` configured for DEMO mode for immediate local judging/demo use. No secrets are included.

## Verification performed

- `DATA_MODE=demo pytest -q` -> 9 passed
- `python -m compileall -q backend ml tests` -> passed
- FastAPI REST smoke tests -> covered by automated tests
- WebSocket demo stream -> covered by automated test

## Environment limitation

The execution environment used to prepare this ZIP could not complete `npm install` because outbound package installation timed out, so the frontend dependency installation/build could not be executed here. Frontend source was updated for strict TypeScript and dependencies are pinned to reproducible versions.
