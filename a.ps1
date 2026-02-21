$ErrorActionPreference = 'Stop'
$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# 1. Rewrite fetchLolStats to stop measuring the "window" size and just return LIVE
$patternStats = '(?s)async function fetchLolStats\(gameId\) \{.+?catch \(err\) \{.+?\}\s*\}'
$replacementStats = @'
async function fetchLolStats(gameId) {
  try {
    const winData = await fetchJson(`https://feed.lolesports.com/livestats/v1/window/${gameId}`);
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'API returned 0 frames' };
    const last = winData.frames[winData.frames.length - 1];
    return { k1: last.blueTeam?.totalKills ?? 0, k2: last.redTeam?.totalKills ?? 0, clock: 'LIVE' };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}
'@
$src = $src -replace $patternStats, $replacementStats

# 2. Fix "Game 0" by making sure the gameNum check searches the correct array
$oldActive = "const activeGame = ((matchedLive?.match?.games?.length ? matchedLive.match.games : e.match?.games) || []).find(g => g.state !== 'completed');"
$newActive = "const gameList = (matchedLive?.match?.games?.length ? matchedLive.match.games : e.match?.games) || [];`n        const activeGame = gameList.find(g => g.state === 'inProgress') || gameList.find(g => g.state !== 'completed');"
$src = $src.Replace($oldActive, $newActive)

$oldNum = "const gameNum = (e.match?.games || []).findIndex(g => g.id === activeGame.id) + 1;"
$newNum = "const gameNum = gameList.findIndex(g => g.id === activeGame.id) + 1;"
$src = $src.Replace($oldNum, $newNum)

[System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
Write-Host "-> Fixed Game 0 and broken sliding window clock!" -ForegroundColor Green
Write-Host "`nIMPORTANT: Restart your dev server (npm run dev / click.bat) for this to take effect!" -ForegroundColor Yellow