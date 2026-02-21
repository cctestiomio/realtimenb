$ErrorActionPreference = 'Stop'

$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan

$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# 1. Aggressively find ANY game that is not 'completed' 
$pattern1 = "g => g.state === 'inProgress'"
$pattern2 = "g => g.state === 'inProgress' || g.state === 'unstarted'"
$replacement = "g => g.state !== 'completed'"

if ($src.Contains($pattern2)) {
    $src = $src.Replace($pattern2, $replacement)
} elseif ($src.Contains($pattern1)) {
    $src = $src.Replace($pattern1, $replacement)
}

# 2. Update the debug message so we can verify the patch actually loaded
$oldDebug = "[DEBUG] Game state is not 'inProgress' (Between games)"
$newDebug = "[DEBUG] Waiting for Riot API game data..."
if ($src.Contains($oldDebug)) {
    $src = $src.Replace($oldDebug, $newDebug)
}

[System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
Write-Host "-> Successfully patched aggressive LoL game state detection!" -ForegroundColor Green
Write-Host "`nIMPORTANT: You MUST restart your dev server (npm run dev / click.bat) for this to take effect!" -ForegroundColor Yellow