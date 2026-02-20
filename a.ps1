# a.ps1

Write-Host "Applying chronological sort to upcoming games..." -ForegroundColor Cyan

$providersPath = Join-Path (Get-Location) "lib\providers.js"
if (-not (Test-Path $providersPath)) { $providersPath = Join-Path (Get-Location) "providers.js" }

if (Test-Path $providersPath) {
    $js = Get-Content -Raw $providersPath

    # Regex pattern to find the exact upcoming filter logic across all providers
    $pattern = 'upcoming:\s*([a-zA-Z0-9_.]+)\.filter\(\(g\)\s*=>\s*inNext12h\(parseDate\(g\.startTime\)\)\)'
    
    # Replacement string appending the .sort() method to order from earliest (top) to latest (bottom)
    $replacement = 'upcoming: $1.filter((g) => inNext12h(parseDate(g.startTime))).sort((a, b) => (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER))'

    # Apply the replacement
    $newJs = $js -replace $pattern, $replacement

    if ($newJs -cne $js) {
        Set-Content -Path $providersPath -Value $newJs -Encoding UTF8
        Write-Host "[OK] Updated providers.js! Upcoming games are now sorted by startTime." -ForegroundColor Green
    } else {
        Write-Host "[WARN] No changes made. It looks like the sort might already be applied or the pattern wasn't found." -ForegroundColor Yellow
    }
} else {
    Write-Host "[ERR] Could not find providers.js. Make sure you run this from the project root." -ForegroundColor Red
}

Write-Host "Done! Refresh your browser." -ForegroundColor Cyan