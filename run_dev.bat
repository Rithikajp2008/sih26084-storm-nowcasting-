@echo off
echo ==============================================================================
echo SIH26084: Real-Time Convective Storm Nowcasting System (0-6 Hr)
echo Ministry of Earth Sciences (MoES) / NCMRWF
echo ==============================================================================

echo [1/2] Starting FastAPI Backend on http://localhost:8000...
start cmd /k "set PYTHONPATH=. && uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload"

echo [2/2] Starting React GIS Frontend on http://localhost:5173...
cd frontend
start cmd /k "npm run dev -- --host 0.0.0.0 --port 5173"

echo.
echo ==============================================================================
echo Systems are launching!
echo Frontend Dashboard: http://localhost:5173
echo Backend API Docs:   http://localhost:8000/docs
echo ==============================================================================
pause
