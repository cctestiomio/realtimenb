$ErrorActionPreference = 'Stop'

$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan

$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# Use Regex to ensure a perfect match regardless of line-ending spaces
$pattern = 'const totalGames\s*=\s*\(e\.match\?\.games\s*\|\|\s*\[\]\)\.length\s*\|\|\s*1;'
$replacement = 'const strategyCount = e.match?.strategy?.count; const totalGames = strategyCount || (e.match?.games || []).length || 1;'

if ($src -match $pattern) {
    $src = $src -replace $pattern, $replacement
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully patched Bo1/Bo3/Bo5 logic!" -ForegroundColor Green
} else {
    Write-Warning "-> Target string not found. It may have already been patched."
}

Write-Host "`nAll patches applied. Run 'npm run dev' to test." -ForegroundColor Yellow