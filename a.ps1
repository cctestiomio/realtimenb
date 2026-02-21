$ErrorActionPreference = 'Stop'

# ==========================================
# 1. PATCH BACKEND (providers.js)
# ==========================================
$file1 = "lib\providers.js"
Write-Host "Patching $file1 (Restoring Aggressive Hunter)..." -ForegroundColor Cyan
$src1 = [System.IO.File]::ReadAllText((Resolve-Path $file1), [System.Text.Encoding]::UTF8)

$startStr = "async function fetchLolStats"
$endStr = "async function getLolData"
$startIdx = $src1.IndexOf($startStr)
$endIdx = $src1.IndexOf($endStr)

if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
    $oldFunc = $src1.Substring($startIdx, $endIdx - $startIdx)
    $newFunc = @'
async function fetchLolStats(gameId) {
  try {
    let winData = null;
    const d = new Date();
    d.setMilliseconds(0);
    const sec = d.getSeconds();
    d.setSeconds(sec - (sec % 10));

    // RESTORED: Aggressively hunt for the absolute newest chunk Riot has published (10s latency).
    const offsets = [10, 20, 30, 40, 50, 60];
    for (const offset of offsets) {
        const attemptDate = new Date(d.getTime() - (offset * 1000));
        const url = 'https://feed.lolesports.com/livestats/v1/window/' + gameId + '?startingTime=' + attemptDate.toISOString();
        
        winData = await fetchJson(url).catch(() => null);
        if (winData && winData.frames && winData.frames.length > 0) {
            break; 
        }
    }

    if (!winData || !winData.frames || !winData.frames.length) {
        winData = await fetchJson('https://feed.lolesports.com/livestats/v1/window/' + gameId).catch(() => null);
    }
    
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'No live frames' };

    // Maintain perfectly synced start time via the stream cancellation trick
    if (!gameStartCache.has(gameId)) {
        try {
            const res = await fetch('https://feed.lolesports.com/livestats/v1/details/' + gameId);
            if (res.ok && res.body) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let chunkStr = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunkStr += decoder.decode(value, { stream: true });
                    const match = chunkStr.match(/"rfc460Timestamp"\s*:\s*"([^"]+)"/);
                    if (match) {
                        gameStartCache.set(gameId, new Date(match[1]).getTime());
                        reader.cancel();
                        break;
                    }
                    if (chunkStr.length > 100000) break; 
                }
            }
        } catch (e) {}
        
        if (!gameStartCache.has(gameId)) {
            gameStartCache.set(gameId, new Date(winData.frames[0].rfc460Timestamp).getTime());
        }
    }

    const frames = winData.frames;
    const last = frames[frames.length - 1];

    let k1 = 0, k2 = 0;
    if (last.blueTeam && last.blueTeam.totalKills !== undefined) {
        k1 = last.blueTeam.totalKills;
        k2 = last.redTeam?.totalKills || 0;
    } else if (last.participants) {
        k1 = last.participants.slice(0, 5).reduce((sum, p) => sum + (p.kills || 0), 0);
        k2 = last.participants.slice(5, 10).reduce((sum, p) => sum + (p.kills || 0), 0);
    }

    const start = gameStartCache.get(gameId);
    const end = new Date(last.rfc460Timestamp).getTime();
    const diff = end - start;
    
    let clock = 'LIVE';
    if (diff >= 0) {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      clock = m + ':' + String(s).padStart(2, '0');
    }

    // NEW: We pass the exact millisecond diff to the frontend so it can reject older frames
    return { k1, k2, clock, rawDiff: diff };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}

'@
    $src1 = $src1.Replace($oldFunc, $newFunc)
    [System.IO.File]::WriteAllText((Resolve-Path $file1), $src1, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully restored absolute lowest latency backend!" -ForegroundColor Green
} else {
    Write-Error "Could not find fetchLolStats block in providers.js"
}

# ==========================================
# 2. PATCH FRONTEND (app.js)
# ==========================================
$file2 = "public\app.js"
Write-Host "Patching $file2 (Adding Monotonic Filter)..." -ForegroundColor Cyan
$src2 = [System.IO.File]::ReadAllText((Resolve-Path $file2), [System.Text.Encoding]::UTF8)

$appTarget = "updateGlobalRefresh();"
$appNew = @'
  // Monotonic Filter: If a slow Lambda returns older data than we already have, ignore it!
  if (data.rawDiff !== undefined) {
      if (ss.maxDiff && data.rawDiff < ss.maxDiff) return; 
      ss.maxDiff = data.rawDiff;
  }

  updateGlobalRefresh();
'@

if ($src2.Contains("ss.maxDiff && data.rawDiff < ss.maxDiff")) {
    Write-Host "-> Frontend already has the Monotonic Filter!" -ForegroundColor Yellow
} elseif ($src2.Contains($appTarget)) {
    $src2 = $src2.Replace($appTarget, $appNew)
    [System.IO.File]::WriteAllText((Resolve-Path $file2), $src2, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully added Monotonic Filter to frontend!" -ForegroundColor Green
} else {
    Write-Error "Could not find 'updateGlobalRefresh();' in app.js"
}