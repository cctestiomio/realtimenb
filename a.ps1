$ErrorActionPreference = 'Stop'
$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

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
    // Removed API headers to prevent 403 rejections on public endpoints
    let winData = await fetchJson('https://feed.lolesports.com/livestats/v1/window/' + gameId).catch(() => null);
    
    if (!winData || !winData.frames || !winData.frames.length) {
        winData = await fetchJson('https://feed.lolesports.com/livestats/v1/details/' + gameId).catch(() => null);
        isDetails = true;
    }
    
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'API returned 0 frames' };
    
    if (!gameStartCache.has(gameId)) {
        if (isDetails) {
            gameStartCache.set(gameId, new Date(winData.frames[0].rfc460Timestamp).getTime());
        } else {
            const details = await fetchJson('https://feed.lolesports.com/livestats/v1/details/' + gameId).catch(() => null);
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

    // Safely calculate kills regardless of which endpoint answered
    let k1 = 0, k2 = 0;
    if (last.blueTeam && last.blueTeam.totalKills !== undefined) {
        k1 = last.blueTeam.totalKills || 0;
        k2 = last.redTeam?.totalKills || 0;
    } else if (last.participants) {
        k1 = last.participants.slice(0, 5).reduce((sum, p) => sum + (p.kills || 0), 0);
        k2 = last.participants.slice(5, 10).reduce((sum, p) => sum + (p.kills || 0), 0);
    }

    return { k1, k2, clock };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}

"@
    $src = $src.Replace($oldFunc, $newFunc)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Restored public endpoint access and fixed kill counting fallback!" -ForegroundColor Green
    Write-Host "`nIMPORTANT: Restart your dev server (npm run dev / click.bat) for this to take effect!" -ForegroundColor Yellow
} else {
    Write-Error "Could not find fetchLolStats block"
}