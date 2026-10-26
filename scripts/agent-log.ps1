# Live, readable view of logs\agent.log. Safe to click in or close - the agent keeps running.
$host.UI.RawUI.WindowTitle = 'Adele Care - agent log (safe to close)'
$log = Join-Path (Split-Path $PSScriptRoot -Parent) 'logs\agent.log'
Write-Host "Waiting for $log ..." -ForegroundColor DarkGray
while (-not (Test-Path $log)) { Start-Sleep -Milliseconds 500 }

Get-Content $log -Wait -Tail 30 | ForEach-Object {
    $line = $_
    try {
        $j = $line | ConvertFrom-Json -ErrorAction Stop
        $time = ([datetime]$j.timestamp).ToLocalTime().ToString('HH:mm:ss')
        $color = switch ($j.level) { 'ERROR' { 'Red' } 'CRITICAL' { 'Red' } 'WARNING' { 'Yellow' } default { 'Gray' } }
        if ($j.message -like 'latency |*' -or $j.message -like 'call ready*') { $color = 'Cyan' }
        Write-Host ("{0}  {1}" -f $time, $j.message) -ForegroundColor $color
    } catch {
        if ($line.Trim()) { Write-Host $line -ForegroundColor DarkGray }
    }
}
