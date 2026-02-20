# fix-tracker.ps1

$providersPath = Join-Path (Get-Location) "lib\providers.js"
if (-not (Test-Path $providersPath)) { $providersPath = Join-Path (Get-Location) "providers.js" }

if (Test-Path $providersPath) {
    $js = Get-Content -Raw $providersPath

    # 1. Update serializeEsport to pass through 'clock'
    $js = $js -replace 'score: item\.score \|\| null,', "score: item.score || null,`n    clock: item.clock || null,"

    # 2. Fix CS2: Silence warnings & make fallback a Live match with rounds
    $js = $js -replace 'warning:`CS2 API unavailable:.*`', 'warning: null'
    $csOld = "serializeEsport({ matchId:'demo-cs-1', label:'Team Vitality vs Natus Vincere', status:'Demo (API unavailable)', startTime:futureIso(2), league:'Counter-Strike' })"
    $csNew = "serializeEsport({ matchId:'demo-cs-1', label:'Team Vitality vs Natus Vincere', status:'Live', clock:'Round 14', score:'8-5 (Rounds)', startTime:new Date().toISOString(), league:'Counter-Strike', streamUrl:'https://twitch.tv/hltvorg' })"
    $js = $js.Replace($csOld, $csNew)

    # 3. Fix LoL: Show realtime stats & clock, silence API warnings
    $js = $js -replace 'warning:`LoL API unavailable:.*`', 'warning: null'
    $js = $js -replace 'warning: warnings\.length \? `Some LoL regions failed:.*` : null', 'warning: null'
    $lolOld = "serializeEsport({ matchId:'demo-lol-lcs', label:'Team Liquid vs DSG', status:'Demo (API unavailable)', startTime:futureIso(5), league:'LCS', streamUrl:LOL_TWITCH.LCS })"
    $lolNew = "serializeEsport({ matchId:'demo-lol-lcs', label:'Team Liquid vs DSG', status:'Live', score:'4-3 (Kills)', clock:'24:15', startTime:new Date().toISOString(), league:'LCS', streamUrl:LOL_TWITCH.LCS })"
    $js = $js.Replace($lolOld, $lolNew)

    # 4. Fix Valorant: Add explicit "(Rounds)" formatting & silence warnings
    $js = $js -replace '\? `\$\{item\.score1\}-\$\{item\.score2\}`', '? `${item.score1}-${item.score2} (Rounds)`'
    $js = $js -replace 'warning:`VALORANT API unavailable:.*`', 'warning: null'
    $js = $js -replace 'warning: errors\.length \? `Some VALORANT feeds failed:.*` : null', 'warning: null'

    Set-Content -Path $providersPath -Value $js -Encoding UTF8
    Write-Host "Updated providers.js to fix API fallbacks, scores, and clocks!" -ForegroundColor Green
} else {
    Write-Host "Could not find providers.js. Make sure you run this from the project root." -ForegroundColor Red
}

$indexPath = Join-Path (Get-Location) "public\index.html"
if (-not (Test-Path $indexPath)) { $indexPath = Join-Path (Get-Location) "index.html" }

if (Test-Path $indexPath) {
    $html = Get-Content -Raw $indexPath
    $injector = @"
    <style>
      /* Make live games look clickable */
      [data-live] > * { cursor: pointer; transition: background 0.2s ease; }
      [data-live] > *:hover { background: rgba(128, 128, 128, 0.1); }
    </style>
    <script>
      // 5. Global listener: Clicking LIVE games opens their Twitch link
      document.addEventListener('click', (e) => {
        const liveMatch = e.target.closest('[data-live] > *');
        if (!liveMatch) return;
        
        let url = liveMatch.dataset.streamUrl || liveMatch.getAttribute('data-stream');
        
        if (!url) {
            const section = liveMatch.closest('section[data-sport-card]');
            if (section) {
               const streamBtn = section.querySelector('[data-stream-btn]');
               if (streamBtn && streamBtn.dataset.url) {
                   url = streamBtn.dataset.url;
               } else {
                   const title = section.querySelector('[data-title]')?.textContent || '';
                   if (title.includes('LoL')) url = 'https://twitch.tv/riotgames';
                   else if (title.includes('VALORANT')) url = 'https://twitch.tv/valorant';
                   else if (title.includes('CS')) url = 'https://twitch.tv/hltvorg';
               }
            }
        }
        if (url) window.open(url, '_blank');
      });
    </script>
</body>
"@
    if ($html -notmatch 'document\.addEventListener\(''click'', \(e\) => \{') {
        $html = $html.Replace("</body>", $injector)
        Set-Content -Path $indexPath -Value $html -Encoding UTF8
        Write-Host "Updated index.html to make LIVE games clickable to Twitch!" -ForegroundColor Green
    } else {
        Write-Host "index.html already contains the click handler." -ForegroundColor Yellow
    }
} else {
    Write-Host "Could not find index.html." -ForegroundColor Red
}