# Start backend (port 8000) and React (port 3000). Closes old windows is left to you.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Starting uvicorn on http://127.0.0.1:8000 ..."
Start-Process powershell -WorkingDirectory $root -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$root'; python -m uvicorn app:app --host 127.0.0.1 --port 8000"
)

Start-Sleep -Seconds 2

Write-Host "Starting React on http://127.0.0.1:3000 ..."
$fe = Join-Path $root 'frontend'
Start-Process powershell -WorkingDirectory $fe -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$fe'; npm start"
)

Write-Host 'Done. Default try order: 1,2,3,0 (USB before laptop). UI: USB/Sony first button. Force index: $env:SHADE_CAMERA_INDEX = 1'
