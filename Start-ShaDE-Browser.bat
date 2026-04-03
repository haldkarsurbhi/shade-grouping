@echo off
setlocal
cd /d "%~dp0"
if not exist "frontend\build\index.html" (
  echo Build the UI first:  cd frontend ^&^& npm install ^&^& npm run build
  pause
  exit /b 1
)
echo [ShaDE] Starting API on http://127.0.0.1:8000 ...
start "ShaDE API" /MIN cmd /c "python -m uvicorn app:app --host 127.0.0.1 --port 8000"
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:8000/ui/"
echo Default browser should open. Close the minimized "ShaDE API" window to stop the server.
pause
