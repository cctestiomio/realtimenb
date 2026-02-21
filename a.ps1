$ErrorActionPreference = 'Stop'

Write-Host "Patching lib/providers.js..."
$provPath = "lib\providers.js"
$prov = [System.IO.File]::ReadAllText((Resolve-Path $provPath))

$fetchStatsStart = $prov.IndexOf("async function fetchLolStats(gameId) {")
$getLolDataStart = $prov.IndexOf("async function getLolData() {")

if ($fetchStatsStart -ne -1 -and $getLolDataStart -ne -1) {
    $before = $prov.Substring(0, $fetchStatsStart)
    $after = $prov.Substring($getLolDataStart)

    $newFetchStats = @'
async function fetchLolStats(gameId) {
  try {
    const winData = await fetchJson(`https://feed.lolesports.com/livestats/v1/window/${gameId}`);
    if (!winData) return { error: 'API returned empty response' };
    if (!winData.frames) return { error: 'API returned no frames object' };
    
    const frames = winData.frames;
    if (!frames.length) return { error: 'API returned 0 frames (Match paused or loading)' };
    
    const last = frames[frames.length - 1];
    const k1 = last.blueTeam?.totalKills ?? 0;
    const k2 = last.redTeam?.totalKills ?? 0;
    const start = new Date(frames[0].rfc460Timestamp).getTime();
    const end = new Date(last.rfc460Timestamp).getTime();
    const diff = end - start;
    
    let clock = 'Live';
    if (diff >= 0) {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      clock = `${m}:${String(s).padStart(2, '0')}`;
    }
    return { k1, k2, clock };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}

'@
    $prov = $before + $newFetchStats + $after
}

$isLiveStart = $prov.IndexOf("if (isLive) {")
$allGamesPush = $prov.IndexOf("allGames.push(serializeEsport({")

if ($isLiveStart -ne -1 -and $allGamesPush -ne -1) {
    $before = $prov.Substring(0, $isLiveStart)
    $after = $prov.Substring($allGamesPush)

    $newIsLive = @'
if (isLive) {
        const activeGame = (e.match?.games || []).find(g => g.state === 'inProgress');
        if (!activeGame) {
          gameTime = "[DEBUG] Game state is not 'inProgress' (Between games)";
        } else if (activeGame.id) {
          const stats = await fetchLolStats(activeGame.id);
          if (stats && stats.error) {
            gameTime = `[DEBUG] ${stats.error}`;
            clock = 'Error';
          } else if (stats) {
            const gameNum = (e.match?.games || []).findIndex(g => g.id === activeGame.id) + 1;
            const t1code = teams[0]?.code || teams[0]?.name?.substring(0,3).toUpperCase() || 'BLU';
            const t2code = teams[1]?.code || teams[1]?.name?.substring(0,3).toUpperCase() || 'RED';
            kills = `${t1code} ${stats.k1} - ${stats.k2} ${t2code}`;
            gameTime = `Game ${gameNum} \u2022 ${stats.clock}`;
            clock = stats.clock;
          }
        }
      }

'@
    $prov = $before + $newIsLive + $after
}

[System.IO.File]::WriteAllText((Resolve-Path $provPath), $prov, [System.Text.Encoding]::UTF8)
Write-Host "-> Patched lib/providers.js successfully!" -ForegroundColor Green

Write-Host "Patching public/app.js..."
$appPath = "public\app.js"
$app = [System.IO.File]::ReadAllText((Resolve-Path $appPath))

if (-not $app.Contains("const isError = timer.includes")) {
    $clockLineStart = $app.IndexOf("let clockLine = data.gameTime")
    $clockHtmlStart = $app.IndexOf("let clockHtml =")

    $targetStart = -1
    if ($clockLineStart -ne -1) { $targetStart = $clockLineStart }
    elseif ($clockHtmlStart -ne -1) { $targetStart = $clockHtmlStart }

    if ($targetStart -ne -1) {
        $targetEnd = $app.IndexOf("ss.clockEl.", $targetStart)
        if ($targetEnd -ne -1) {
            $targetEnd = $app.IndexOf(";", $targetEnd) + 1

            $before = $app.Substring(0, $targetStart)
            $after = $app.Substring($targetEnd)

            $newClockHtml = @'
let clockHtml = '';
  if (isLiveStatus(data.status) && (data.gameTime || data.clock)) {
      const timer = data.gameTime || data.clock;
      const killStr = data.kills ? `<span style="margin-left:8px; padding-left:8px; border-left:1px solid var(--line); color:var(--text);">&#9876;&#xFE0F; ${data.kills}</span>` : '';
      
      const isError = timer.includes('[DEBUG]');
      const color = isError ? 'var(--error)' : 'var(--live)';
      
      clockHtml += `<div style="font-weight:700; color:${color}; margin-top:6px; margin-bottom:2px; font-size:1.05em;">${timer}${killStr}</div>`;
  }
  clockHtml += `<div style="margin-top:2px; font-size:0.85em; color:var(--muted);">${formatPacificTime(data.startTime)}</div>`;
  ss.clockEl.innerHTML = clockHtml;
'@
            $app = $before + $newClockHtml + $after
            [System.IO.File]::WriteAllText((Resolve-Path $appPath), $app, [System.Text.Encoding]::UTF8)
            Write-Host "-> Patched public/app.js successfully!" -ForegroundColor Green
        }
    } else {
        Write-Host "-> Anchor for app.js not found. It may be patched already." -ForegroundColor Yellow
    }
} else {
    Write-Host "-> public/app.js already has the debug UI code." -ForegroundColor Yellow
}

Write-Host "`nAll patches applied. Run 'npm run dev' to test." -ForegroundColor Cyan