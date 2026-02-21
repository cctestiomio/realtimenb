$ErrorActionPreference = 'Stop'
$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# 1. Inject a memory cache for the true game start time at the top of the file
if (-not $src.Contains("const gameStartCache = new Map();")) {
    $src = "const gameStartCache = new Map();`n" + $src
}

# 2. Rewrite fetchLolStats to calculate true elapsed time
$startStr = "async function fetchLolStats"
$endStr = "async function getLolData"
$startIdx = $src.IndexOf($startStr)
$endIdx = $src.IndexOf($endStr)

if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
    $oldFunc = $src.Substring($startIdx, $endIdx - $startIdx)
    $newFunc = @"
async function fetchLolStats(gameId) {
  try {
    let isDetails = false;
    let winData = await fetchJson('https://feed.lolesports.com/livestats/v1/window/' + gameId, { headers: riotHeaders() }).catch(() => null);
    
    if (!winData || !winData.frames || !winData.frames.length) {
        winData = await fetchJson('https://feed.lolesports.com/livestats/v1/details/' + gameId, { headers: riotHeaders() }).catch(() => null);
        isDetails = true;
    }
    
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'API returned 0 frames' };
    
    // One-time fetch to find the absolute true start time of the game
    if (!gameStartCache.has(gameId)) {
        if (isDetails) {
            gameStartCache.set(gameId, new Date(winData.frames[0].rfc460Timestamp).getTime());
        } else {
            const details = await fetchJson('https://feed.lolesports.com/livestats/v1/details/' + gameId, { headers: riotHeaders() }).catch(() => null);
            if (details && details.frames && details.frames.length) {
                gameStartCache.set(gameId, new Date(details.frames[0].rfc460Timestamp).getTime());
            } else {
                gameStartCache.set(gameId, new Date(winData.frames[0].rfc460Timestamp).getTime());
            }
        }
    }
    
    const last = winData.frames[winData.frames.length - 1];
    const start = gameStartCache.get(gameId);
    const end = new Date(last.rfc460Timestamp).getTime();
    const diff = end - start;
    
    let clock = 'LIVE';
    if (diff >= 0) {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      clock = m + ':' + String(s).padStart(2, '0');
    }

    return { k1: last.blueTeam?.totalKills ?? 0, k2: last.redTeam?.totalKills ?? 0, clock };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}

"@
    $src = $src.Replace($oldFunc, $newFunc)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully patched true elapsed game timer logic!" -ForegroundColor Green
    Write-Host "`nIMPORTANT: You must restart your dev server (close terminal, run click.bat) for this to take effect!" -ForegroundColor Yellow
} else {
    Write-Error "Could not find fetchLolStats block"
}