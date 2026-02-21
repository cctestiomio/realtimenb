$ErrorActionPreference = 'Stop'
$file = "public\app.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# 1. Reset the maxSecs tracker when you click a new match
$startTrackingPattern = "ss\.currentQuery\s*=\s*query;"
if ($src -match $startTrackingPattern -and -not $src.Contains("ss.maxSecs = -1;")) {
    $src = $src -replace $startTrackingPattern, "ss.currentQuery = query; ss.maxSecs = -1;"
}

# 2. Add the String-Parsing Monotonic Filter
$renderPattern = "(function renderTrackedMatch\(sportKey, data\) \{[\s\S]*?if \(!ss\) return;)"
    
$filterLogic = @'

  // Strict Monotonic Filter for League of Legends
  // Parses the clock string directly. If a lagging CDN node tries to send an 
  // older timestamp, we completely drop the packet and freeze the UI at the newest time.
  if (sportKey === 'lol' && data.clock && typeof data.clock === 'string') {
      const timeMatch = data.clock.match(/(\d+):(\d+)/);
      if (timeMatch) {
          const secs = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
          if (ss.maxSecs !== undefined && secs < ss.maxSecs) {
              // Failsafe: if time jumps back by more than 10 minutes, assume game remake
              if (ss.maxSecs - secs > 600) {
                  ss.maxSecs = secs;
              } else {
                  return; // Silently drop lagging CDN packet!
              }
          } else {
              ss.maxSecs = secs;
          }
      }
  }
'@

# Clean out the old non-working filters
$src = $src -replace '(?s)// Sliding Window Minimum Filter.*?if \(stableDiff >= 0\) \{.*?\}\n\s*\}\n', ''
$src = $src -replace '(?s)// Monotonic Filter:.*?ss\.maxDiff = data\.rawDiff;\n\s*\}\n', ''

if (!$src.Contains("ss.maxSecs = secs;")) {
    $src = $src -replace $renderPattern, "`$1$filterLogic"
}

[System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
Write-Host "-> Successfully applied bulletproof frontend timer filter!" -ForegroundColor Green