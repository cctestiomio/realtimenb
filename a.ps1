$ErrorActionPreference = 'Stop'
$file = "public\app.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

$targetLine = "ss.clockEl.innerHTML = clockHtml;"

$newCode = @'
  // Add direct Twitch links for major LoL leagues
  if (sportKey === 'lol' && data.league) {
      const l = data.league.toUpperCase();
      let tw = '';
      if (l.includes('LEC')) tw = 'lec';
      else if (l.includes('CBLOL')) tw = 'cblol';
      else if (l.includes('LCK')) tw = 'lck';
      else if (l.includes('LCS')) tw = 'lcs';
      else if (l.includes('LPL')) tw = 'lpl';
      
      if (tw) {
          clockHtml += `<div style="margin-top:8px;">
            <a href="https://twitch.tv/${tw}" target="_blank" style="color:#9146FF; text-decoration:none; font-weight:600; font-size:0.95em; display:inline-block; padding:3px 6px; border:1px solid rgba(145, 70, 255, 0.5); border-radius:4px; background:rgba(145, 70, 255, 0.1);">
              &#128250; twitch.tv/${tw}
            </a>
          </div>`;
      }
  }
  ss.clockEl.innerHTML = clockHtml;
'@

if ($src.Contains('twitch.tv/${tw}')) {
    Write-Host "-> File is already patched!" -ForegroundColor Yellow
} elseif ($src.Contains($targetLine)) {
    $src = $src.Replace($targetLine, $newCode)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully added Twitch links to app.js!" -ForegroundColor Green
} else {
    Write-Error "Could not find the target line 'ss.clockEl.innerHTML = clockHtml;' in app.js."
}