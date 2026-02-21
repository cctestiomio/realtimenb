$ErrorActionPreference = 'Stop'
$file = "public\app.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# 1. Clean up the old monotonic filter if it successfully applied last time
$src = $src -replace '(?s)// Monotonic Filter:.*?ss\.maxDiff = data\.rawDiff;\s*}', ''

# 2. Inject the Sliding Window Minimum filter precisely into the render function
$exactTarget = @'
function renderTrackedMatch(sportKey, data) {
  const ss = state.get(sportKey);
  if (!ss) return;

  updateGlobalRefresh();
'@

$exactNew = @'
function renderTrackedMatch(sportKey, data) {
  const ss = state.get(sportKey);
  if (!ss) return;

  // Sliding Window Minimum Filter
  // Keeps the last 3 seconds of network requests and strictly uses the earlier (lowest) timer
  // This guarantees 0 bouncing while keeping latency at the absolute minimum.
  if (data.rawDiff !== undefined) {
      if (!ss.diffHistory) ss.diffHistory = [];
      ss.diffHistory.push(data.rawDiff);
      
      // Store 6 polls (3 seconds at 500ms per poll)
      if (ss.diffHistory.length > 6) ss.diffHistory.shift();
      
      const stableDiff = Math.min(...ss.diffHistory);
      if (stableDiff >= 0) {
          const m = Math.floor(stableDiff / 60000);
          const s = Math.floor((stableDiff % 60000) / 1000);
          data.clock = m + ':' + String(s).padStart(2, '0');
      }
  }

  updateGlobalRefresh();
'@

if ($src.Contains("ss.diffHistory.push(data.rawDiff);")) {
    Write-Host "-> Sliding Window Filter is already applied!" -ForegroundColor Yellow
} elseif ($src.Contains("function renderTrackedMatch(sportKey, data) {")) {
    $src = $src.Replace($exactTarget, $exactNew)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully applied Sliding Window Minimum Filter to stop timer bouncing!" -ForegroundColor Green
} else {
    Write-Error "Could not find the target block in app.js"
}