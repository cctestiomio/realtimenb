$ErrorActionPreference = 'Stop'

$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

# 1. Update fetchLolLive to push the full un-cached event
$src = $src -replace 'liveEvents\.push\(\{ id: ev\.id, startTime: parseDate\(ev\.startTime\), leagueId: ev\.league\?\.id \}\);', 'liveEvents.push(ev);'

# 2. Fix the liveEvents.find logic since we changed what is stored in the array
$src = $src -replace 'lev\.leagueId === result\.value\.region\.leagueId', 'lev.league?.id === result.value.region.leagueId'
$src = $src -replace 'Math\.abs\(lev\.startTime - eStart\)', 'Math.abs((parseDate(lev.startTime)||0) - eStart)'

# 3. Pull the active game from the un-cached matchedLive object first, bypassing the CDN delay
$src = $src -replace 'const activeGame = \(e\.match\?\.games \|\| \[\]\)\.find\(g => g\.state[^;]+;', 'const activeGame = ((matchedLive?.match?.games?.length ? matchedLive.match.games : e.match?.games) || []).find(g => g.state !== ''completed'');'

# 4. Remove [DEBUG] keyword so the UI shows it in Green instead of Red error text if in Champion Select
$src = $src.Replace("[DEBUG] Waiting for Riot API game data...", "Live API syncing...")
$src = $src.Replace("[DEBUG] Game state is not 'inProgress' (Between games)", "Live API syncing...")

[System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)

Write-Host "-> Bypassed Riot's CDN cache and cleaned up UI text!" -ForegroundColor Green
Write-Host "`nIMPORTANT: Restart your dev server (npm run dev / click.bat) for this to take effect!" -ForegroundColor Yellow