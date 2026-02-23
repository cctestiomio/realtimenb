$ErrorActionPreference = 'Stop'

# --- 1. Fix the Alternating Data Sources ---
$provFile = "lib\providers.js"
Write-Host "Patching $provFile..." -ForegroundColor Cyan
$provSrc = [System.IO.File]::ReadAllText((Resolve-Path $provFile), [System.Text.Encoding]::UTF8)

$oldNbaFunc = "(?s)async function getNbaData\(\) \{.*?warning: null\s*\};\s*\}"
$newNbaFunc = @'
async function getNbaData() {
  let games = [];
  let warning = null;
  
  // Stop the alternating formats by strictly preferring the CDN. 
  // Only fallback to ESPN if CDN explicitly fails.
  try {
    const p = await fetchJson(NBA_URL);
    games = (p?.scoreboard?.games || []).map(serializeNbaFromCdn);
  } catch (e) {
    try {
      const p2 = await fetchJson(NBA_FALLBACK_URL);
      games = (p2?.events || []).map(serializeNbaFromEspn);
      warning = 'Using ESPN fallback';
    } catch (e2) {}
  }
  
  if (!games?.length) return { games: [], upcoming: [], warning: null };
  return {
    games,
    upcoming: games
      .filter(g => inNext12h(parseDate(g.startTime)))
      .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
    warning
  };
}
'@

if ($provSrc -match $oldNbaFunc) {
    $provSrc = $provSrc -replace $oldNbaFunc, $newNbaFunc
    [System.IO.File]::WriteAllText((Resolve-Path $provFile), $provSrc, [System.Text.Encoding]::UTF8)
    Write-Host "-> Fixed alternating NBA data sources!" -ForegroundColor Green
} else {
    Write-Host "-> NBA data source function already modified or not found." -ForegroundColor Yellow
}

# --- 2. Add Safe Lead Calculation ---
$appFile = "public\app.js"
Write-Host "Patching $appFile..." -ForegroundColor Cyan
$appSrc = [System.IO.File]::ReadAllText((Resolve-Path $appFile), [System.Text.Encoding]::UTF8)

$targetCode = "ss.clockEl.textContent = displayClock;"
$safeLeadCode = @'
        let safeLeadHtml = '';
        if (isLive && data.clock && /Q4|OT/.test(data.clock)) {
            const match = data.clock.match(/(?:Q4|OT\d*)\s+(\d+):(\d+(?:\.\d+)?)/);
            if (match) {
                const secs = (parseInt(match[1], 10) * 60) + parseFloat(match[2]);
                if (secs > 0) {
                    // Safe Lead = sqrt(S) + 3.5 (assuming trailing team has the ball for worst case)
                    const target = Math.ceil(Math.sqrt(secs) + 3.5);
                    const gap = Math.abs(data.home.score - data.away.score);
                    const leader = data.home.score > data.away.score ? data.home.code : (data.away.score > data.home.score ? data.away.code : null);
                    
                    if (leader) {
                        const isSafe = gap >= target;
                        const color = isSafe ? 'var(--live)' : 'var(--accent)';
                        const icon = isSafe ? '&#128274;' : '&#9889;';
                        const statusTxt = isSafe ? 'Safe Lead' : 'Vulnerable';
                        safeLeadHtml = `<div style="margin-top: 8px; font-size: 0.9em; font-weight: 700; color: ${color};">
                            ${icon} ${statusTxt} 
                            <span style="font-weight: 400; color: var(--muted);">(Gap: ${gap}, Safe at: ${target})</span>
                        </div>`;
                    }
                }
            }
        }
        ss.clockEl.innerHTML = displayClock + safeLeadHtml;
'@

if (!$appSrc.Contains("safeLeadHtml")) {
    $appSrc = $appSrc.Replace($targetCode, $safeLeadCode)
    [System.IO.File]::WriteAllText((Resolve-Path $appFile), $appSrc, [System.Text.Encoding]::UTF8)
    Write-Host "-> Added Safe Lead calculation UI!" -ForegroundColor Green
} else {
    Write-Host "-> Safe Lead UI already exists in app.js." -ForegroundColor Yellow
}