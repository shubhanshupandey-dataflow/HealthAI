# Starts the backend (API + admin panel) and the voice agent.
# Usage:  powershell -ExecutionPolicy Bypass -File .\start.ps1      (stop with .\stop.ps1)
$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) { Write-Host "Python environment missing - see README (Setup)." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $root ".env"))) { Write-Host "Create .env first (copy .env.example)." -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force (Join-Path $root "logs") | Out-Null

if (-not (Test-Path (Join-Path $root "admin\dist\index.html"))) {
    Write-Host "Building the admin panel..." -ForegroundColor Cyan
    npm --prefix (Join-Path $root "admin") run build
}

# Backend + admin panel
Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Adele Care - backend (port 8000)'; & '$python' -m uvicorn backend.main:app --host 0.0.0.0 --port 8000"

# Voice agent (production mode, logs to logs\agent.log) + a log viewer window
Start-Process (Join-Path $root "scripts\run-agent.cmd") -WorkingDirectory $root -WindowStyle Minimized
Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $root "scripts\agent-log.ps1")

Write-Host "Starting... the voice agent is ready a few seconds after this." -ForegroundColor Cyan
Write-Host "Wait for 'registered worker' in the agent log window, then call Sophie." -ForegroundColor Cyan
Start-Sleep -Seconds 3
Start-Process "http://localhost:8000"
Write-Host "Admin panel: http://localhost:8000" -ForegroundColor Green
