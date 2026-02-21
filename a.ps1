$ErrorActionPreference = 'Stop'

function Patch-File {
    param([string]$FilePath, [hashtable]$Replacements)
    if (-not (Test-Path $FilePath)) {
        Write-Warning "File not found: $FilePath"
        return
    }
    Write-Host "Patching: $FilePath" -ForegroundColor Cyan
    $src = [System.IO.File]::ReadAllText((Resolve-Path $FilePath), [System.Text.Encoding]::UTF8)

    foreach ($old in $Replacements.Keys) {
        $new = $Replacements[$old]
        if ($src.Contains($old)) {
            $src = $src.Replace($old, $new)
            Write-Host "  [OK] Replaced target block" -ForegroundColor Green
        } else {
            Write-Warning "  [SKIP] Anchor not found in $FilePath"
        }
    }
    [System.IO.File]::WriteAllText((Resolve-Path $FilePath), $src, [System.Text.Encoding]::UTF8)
}

# 1. Patch the Backend (providers.js)
Patch-File -FilePath "lib\providers.js" -Replacements @{
@'
async function fetchLolStats(gameId) {
  try {
    const winData = await fetchJson(
      `https://feed.lolesports.com/livestats/v1/window/${gameId}`,
      { headers: riotHeaders() }
    );
'@ = @'
async function fetchLolStats(gameId) {
  try {
    // Dropped riotHeaders() - sending the API key to the open feed causes a rejection
    const winData = await fetchJson(
      `https://feed.lolesports.com/livestats/v1/window/${gameId}`
    );
'@;

@'
            const t1name  = teams[0]?.name || 'Blue';
            const t2name  = teams[1]?.name || 'Red';
            kills    = `${t1name}: ${stats.k1}K  /  ${t2name}: ${stats.k2}K`;
            gameTime = `Game ${gameNum} - ${stats.clock}`;
'@ = @'
            const t1code  = teams[0]?.code || teams[0]?.name?.substring(0,3).toUpperCase() || 'BLU';
            const t2code  = teams[1]?.code || teams[1]?.name?.substring(0,3).toUpperCase() || 'RED';
            kills    = `${t1code} ${stats.k1} - ${stats.k2} ${t2code}`;
            gameTime = `Game ${gameNum} \u2022 ${stats.clock}`;
'@
}

# 2. Patch the Frontend (app.js)
Patch-File -FilePath "public\app.js" -Replacements @{
@'
  // Clock line: game elapsed time, then kills on same line if available
  let clockLine = data.gameTime || data.clock || formatPacificTime(data.startTime);
  if (data.kills) clockLine += `  |  ${data.kills}`;
  ss.clockEl.textContent = clockLine;
'@ = @'
  // Clock line: game elapsed time, kills, and start time cleanly separated
  let clockHtml = '';
  if (isLiveStatus(data.status) && (data.gameTime || data.clock)) {
      const timer = data.gameTime || data.clock;
      const killStr = data.kills ? `<span style="margin-left:8px; padding-left:8px; border-left:1px solid var(--line); color:var(--text);">&#9876;&#xFE0F; ${data.kills}</span>` : '';
      clockHtml += `<div style="font-weight:700; color:var(--live); margin-top:6px; margin-bottom:2px; font-size:1.05em;">${timer}${killStr}</div>`;
  }
  clockHtml += `<div style="margin-top:2px; font-size:0.85em; color:var(--muted);">${formatPacificTime(data.startTime)}</div>`;
  ss.clockEl.innerHTML = clockHtml;
'@
}

Write-Host "`nAll patches applied. Run npm run dev to test." -ForegroundColor Yellow