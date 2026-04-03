@echo off
setlocal
cd /d "%~dp0desktop"
if not exist "node_modules\" (
  echo [ShaDE] Installing Electron (first time only^)...
  call npm install
  if errorlevel 1 exit /b 1
)
echo [ShaDE] Starting desktop app...
call npm start
