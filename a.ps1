$ErrorActionPreference = 'Stop'

$appFile = "public\app.js"
Write-Host "Patching $appFile..." -ForegroundColor Cyan
$appSrc = [System.IO.File]::ReadAllText((Resolve-Path $appFile), [System.Text.Encoding]::UTF8)

# --- 1. Prevent list refresh from hijacking the currently tracked game ---
$oldAuto = "(?s)const autoTrack = liveGames\[0\] \|\| upcomingGames\[0\];\s*if \(autoTrack\) \{\s*ss\.input\.value = autoTrack\.label;\s*startTracking\(sportKey, autoTrack\.label\);\s*\}"

$newAuto = @'
    const autoTrack = liveGames[0] || upcomingGames[0];
    if (autoTrack && !ss.currentQuery) {
      ss.input.value = autoTrack.label;
      startTracking(sportKey, autoTrack.label);
    }
    
    // Ensure the currently tracked game stays highlighted after the list rebuilds
    if (ss.currentQuery) {
      setActiveChip(sportKey, ss.currentQuery);
    }
'@

if ($appSrc -match $oldAuto) {
    $appSrc = $appSrc -replace $oldAuto, $newAuto
    Write-Host "-> Fixed auto-track hijack logic!" -ForegroundColor Green
} else {
    Write-Host "-> Auto-track logic already patched or not found." -ForegroundColor Yellow
}

# --- 2. Add the 5-second polling loop for the game lists ---
$oldInit = "(?s)for \(const sport of sports\) loadSportData\(sport\.key\);"
$newInit = @'
for (const sport of sports) {
  loadSportData(sport.key);
  // Auto-refresh the list every 5 seconds
  setInterval(() => loadSportData(sport.key), 5000);
}
'@

if ($appSrc -match $oldInit) {
    $appSrc = $appSrc -replace $oldInit, $newInit
    Write-Host "-> Added 5-second background polling for game lists!" -ForegroundColor Green
} else {
    Write-Host "-> Polling loop already added or not found." -ForegroundColor Yellow
}

[System.IO.File]::WriteAllText((Resolve-Path $appFile), $appSrc, [System.Text.Encoding]::UTF8)
Write-Host "Done!" -ForegroundColor Cyan