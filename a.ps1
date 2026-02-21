$ErrorActionPreference = 'Stop'

$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan

$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# The exact string looking for only 'inProgress'
$target = "const activeGame = (e.match?.games || []).find(g => g.state === 'inProgress');"

# The replacement string adding 'unstarted' as a valid state
$replacement = "const activeGame = (e.match?.games || []).find(g => g.state === 'inProgress' || g.state === 'unstarted');"

if ($src.Contains($target)) {
    $src = $src.Replace($target, $replacement)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully patched LoL game state detection in lib/providers.js!" -ForegroundColor Green
} else {
    Write-Warning "-> Target string not found. It may have already been patched."
}

Write-Host "`nDone! Restart your dev server (if not using click.bat) to apply the backend changes." -ForegroundColor Yellow