# Stops the backend and the voice agent started by start.ps1.
# (The agent's helper processes exit on their own once the agent is gone.)
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine -match 'uvicorn backend\.main' -or $_.CommandLine -match 'agent\\agent\.py')
}
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "stopped PID $($p.ProcessId)" }
if (-not $procs) { Write-Host "Nothing running." }
