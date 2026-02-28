$ErrorActionPreference = 'Stop'

$appFile = "public\app.js"
Write-Host "Reverting changes in $appFile..." -ForegroundColor Cyan
$appSrc = [System.IO.File]::ReadAllText((Resolve-Path $appFile), [System.Text.Encoding]::UTF8)

# --- 1. Revert the 5-second polling loop ---
$badInit = "(?s)for \(const sport of sports\) \{\s*loadSportData\(sport\.key\);\s*// Auto-refresh the list every 5 seconds\s*setInterval\(\(\) => loadSportData\(sport\.key\), 5000\);\s*\}"

$goodInit = "for (const sport of sports) loadSportData(sport.key);"

if ($appSrc -match $badInit) {
    $appSrc = $appSrc -replace $badInit, $goodInit
    Write-Host "-> Reverted the 5-second polling loop!" -ForegroundColor Green
} else {
    Write-Host "-> Polling loop not found (already reverted?)." -ForegroundColor Yellow
}

# --- 2. Revert the auto-track logic ---
$badAuto = "(?s)const autoTrack = liveGames\[0\] \|\| upcomingGames\[0\];\s*if \(autoTrack && !ss\.currentQuery\) \{\s*ss\.input\.value = autoTrack\.label;\s*startTracking\(sportKey, autoTrack\.label\);\s*\}\s*// Ensure the currently tracked game stays highlighted after the list rebuilds\s*if \(ss\.currentQuery\) \{\s*setActiveChip\(sportKey, ss\.currentQuery\);\s*\}"

$goodAuto = @'
    const autoTrack = liveGames[0] || upcomingGames[0];
    if (autoTrack) {
      ss.input.value = autoTrack.label;
      startTracking(sportKey, autoTrack.label);
    }
'@

if ($appSrc -match $badAuto) {
    $appSrc = $appSrc -replace $badAuto, $goodAuto
    Write-Host "-> Reverted the auto-track logic!" -ForegroundColor Green
} else {
    Write-Host "-> Auto-track logic not found (already reverted?)." -ForegroundColor Yellow
}

[System.IO.File]::WriteAllText((Resolve-Path $appFile), $appSrc, [System.Text.Encoding]::UTF8)
Write-Host "Revert complete!" -ForegroundColor Cyan