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
    const winData = await fetchJson('https://feed.lolesports.com/livestats/v1/window/' + gameId).catch(() => null);
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'No live window' };

    // 1. Fix the "Stuck at 0:05" bug
    // Stream the details endpoint just enough to grab the true game start time.
    // This prevents massive JSON timeout issues in serverless.
    if (!gameStartCache.has(gameId)) {
        try {
            const res = await fetch('https://feed.lolesports.com/livestats/v1/details/' + gameId);
            if (res.ok && res.body) {
                let chunkStr = '';
                for await (const chunk of res.body) {
                    chunkStr += chunk.toString();
                    const match = chunkStr.match(/"rfc460Timestamp"\s*:\s*"([^"]+)"/);
                    if (match) {
                        gameStartCache.set(gameId, new Date(match[1]).getTime());
                        if (typeof res.body.destroy === 'function') res.body.destroy();
                        if (typeof res.body.cancel === 'function') res.body.cancel();
                        break;
                    }
                    if (chunkStr.length > 200000) break;
                }
            }
        } catch(e) {}
        
        if (!gameStartCache.has(gameId)) {
            gameStartCache.set(gameId, new Date(winData.frames[0].rfc460Timestamp).getTime());
        }
    }

    const frames = winData.frames;
    const lastTimeFrame = frames[frames.length - 1];
    
    // 2. Fix the "Kills are 0 - 0" bug
    // Scan backwards for the last frame that actually contains game state.
    // Riot often sends empty "heartbeat" frames at the end of the array.
    const stateFrame = frames.slice().reverse().find(f => f.blueTeam || (f.participants && f.participants.length > 0)) || lastTimeFrame;

    const start = gameStartCache.get(gameId);
    const end = new Date(lastTimeFrame.rfc460Timestamp).getTime();
    let diff = end - start;
    
    let clock = 'LIVE';
    if (diff >= 0) {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      clock = m + ':' + String(s).padStart(2, '0');
    }

    let k1 = 0, k2 = 0;
    if (stateFrame.blueTeam) {
        k1 = stateFrame.blueTeam.totalKills ?? stateFrame.blueTeam.kills ?? 0;
        k2 = stateFrame.redTeam?.totalKills ?? stateFrame.redTeam?.kills ?? 0;
    } else if (stateFrame.participants && stateFrame.participants.length >= 10) {
        k1 = stateFrame.participants.slice(0, 5).reduce((sum, p) => sum + (p.kills || 0), 0);
        k2 = stateFrame.participants.slice(5, 10).reduce((sum, p) => sum + (p.kills || 0), 0);
    }

    return { k1, k2, clock };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}

"@
    $src = $src.Replace($oldFunc, $newFunc)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully patched LoL fetching logic!" -ForegroundColor Green
} else {
    Write-Error "Could not find fetchLolStats block"
}