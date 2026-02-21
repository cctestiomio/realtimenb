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
    $newFunc = "async function fetchLolStats(gameId) {
  try {
    let winData = await fetchJson('https://feed.lolesports.com/livestats/v1/window/' + gameId, { headers: riotHeaders() }).catch(() => null);
    if (!winData || !winData.frames || !winData.frames.length) {
        winData = await fetchJson('https://feed.lolesports.com/livestats/v1/details/' + gameId, { headers: riotHeaders() }).catch(() => null);
    }
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'API returned 0 frames' };
    const last = winData.frames[winData.frames.length - 1];
    return { k1: last.blueTeam?.totalKills ?? 0, k2: last.redTeam?.totalKills ?? 0, clock: 'LIVE' };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}`n`n"
    $src = $src.Replace($oldFunc, $newFunc)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Restored missing Riot API headers and added /details fallback!" -ForegroundColor Green
    Write-Host "`nIMPORTANT: You must restart your dev server (close terminal, run click.bat) for this to take effect!" -ForegroundColor Yellow
} else {
    Write-Error "Could not find fetchLolStats block"
}