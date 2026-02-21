$ErrorActionPreference = 'Stop'

$file = "public\app.js"
Write-Host "Patching $file..." -ForegroundColor Cyan

$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# Matches the exact JS block generating the redundant "Live • LIVE" string for Esports chips
$pattern = '(?s)(const timeStr = game\.clock \|\| ''LIVE'';\s+)content = `\$\{game\.label\} \$\{BULLET\} \$\{game\.status\} \$\{BULLET\} \$\{timeStr\}`;'

# Injects the start time formatter and replaces the status variable
$replacement = '${1}const startStr = formatPacificTime(game.startTime);' + [Environment]::NewLine + '             content = `${game.label} ${BULLET} ${startStr} ${BULLET} ${timeStr}`;'

if ($src -match $pattern) {
    $src = $src -replace $pattern, $replacement
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully patched redundant Live tags in public/app.js!" -ForegroundColor Green
} else {
    Write-Warning "-> Target string not found. It may have already been patched."
}

Write-Host "`nDone! Just refresh your browser (no need to restart the server)." -ForegroundColor Yellow