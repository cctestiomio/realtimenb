<#
.SYNOPSIS
    Automated Remediation Script for Vercel Serverless Crashes (JSDOM Removal)

.DESCRIPTION
    This script parses lib/providers.js. It performs regex substitutions to:
    1. Eradicate the memory-heavy 'jsdom' import which crashes Vercel on cold boots.
    2. Replace the fetchVlrMatchDetails function with a lightweight Regex parser.
    3. Replace the getValorantData function with a lightweight Regex parser.
#>

$FilePath = ".\lib\providers.js"

if (-Not (Test-Path $FilePath)) {
    Write-Error "CRITICAL: Target file not found at path: $FilePath. Execution aborted."
    exit
}

$Content = Get-Content -Path $FilePath -Raw

# =====================================================================
# PHASE 1: Remove the memory-leaking JSDOM import
# =====================================================================
$Content = $Content -replace '(?m)^import\s+\{\s*JSDOM\s*\}\s+from\s+[''"]jsdom[''"];?\s*$', ''

# =====================================================================
# PHASE 2: Rewrite fetchVlrMatchDetails without JSDOM
# =====================================================================
$oldVlrDetails = '(?s)async function fetchVlrMatchDetails\(url\).*?(?=async function getValorantData)'
$newVlrDetails = @'
async function fetchVlrMatchDetails(url) {
    try {
        const text = await fetchText(url);
        if (!text) return {};
        let streamUrl = null;
        let roundScore = null;
        
        const siteId = text.match(/data-site-id=["']([^"']+)["']/);
        if (siteId) streamUrl = `https://twitch.tv/${siteId[1]}`;
        else {
            const extLink = text.match(/class=["'][^"']*match-streams-btn-external[^"']*["'][^>]*href=["']([^"']+)["']/);
            if (extLink) streamUrl = extLink[1];
        }
        
        const activeMap = text.match(/class=["'][^"']*vm-stats-gamesnav-item[^"']*mod-active[^"']*["'][^>]*>.*?<div[^>]*>\s*(\d+)\s*:\s*(\d+)\s*<\/div>/s);
        if (activeMap) roundScore = `${activeMap[1]}-${activeMap[2]}`;
        else {
            const liveScore = text.match(/class=["'][^"']*vlr-live-score[^"']*["'][^>]*>([^<]+)<\/div>/);
            if (liveScore) roundScore = liveScore[1].trim();
        }
        return { streamUrl, roundScore };
    } catch { return {}; }
}

'@
$Content = $Content -replace $oldVlrDetails, $newVlrDetails

# =====================================================================
# PHASE 3: Rewrite getValorantData without JSDOM
# =====================================================================
$oldVlrData = '(?s)async function getValorantData\(\).*?(?=// === CS2 ===)'
$newVlrData = @'
async function getValorantData() {
  const allGames = [];
  try {
     const text = await fetchText('https://www.vlr.gg/matches');
     const matchNodes = text.match(/<a[^>]*href=["']\/(\d+)\/[^"']+["'][^>]*class=["'][^"']*match-item[^"']*["'][\s\S]*?<\/a>/g) || [];
     const now = new Date();

     for (const node of matchNodes) {
         const idMatch = node.match(/href=["']\/(\d+)\//);
         const id = idMatch ? idMatch[1] : 'unknown';
         const matchUrl = `https://www.vlr.gg/${id}`;

         const teams = [...node.matchAll(/class=["']match-item-vs-team-name["'][^>]*>\s*([^<]+?)\s*<\/div>/g)];
         const t1 = teams[0] ? teams[0][1].trim() : 'TBD';
         const t2 = teams[1] ? teams[1][1].trim() : 'TBD';

         const eventNode = node.match(/class=["']match-item-event["'][^>]*>([\s\S]*?)<\/div>/);
         let league = eventNode ? eventNode[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim() : 'Valorant';

         const statusNode = node.match(/class=["']ml-status["'][^>]*>\s*([^<]+?)\s*<\/div>/);
         let isLive = statusNode && statusNode[1].trim().toLowerCase() === 'live';

         const scores = [...node.matchAll(/class=["']match-item-vs-team-score["'][^>]*>\s*([^<]+?)\s*<\/div>/g)];
         let s1 = scores[0] ? scores[0][1].trim() : '0';
         let s2 = scores[1] ? scores[1][1].trim() : '0';
         let score = `${s1}-${s2}`;

         let startTime = isLive ? now.toISOString() : new Date().toISOString();

         allGames.push({
             matchId: id, label: `${t1} vs ${t2}`, status: isLive ? 'Live' : 'Scheduled',
             startTime, league, score, matchUrl, clock: null, streamUrl: null
         });
     }

     const liveGames = allGames.filter(g => g.status === 'Live');
     const upcomingGames = allGames.filter(g => g.status !== 'Live').slice(0, 5);
     const targets = [...liveGames, ...upcomingGames];

     await Promise.all(targets.map(async (g) => {
         const details = await fetchVlrMatchDetails(g.matchUrl);
         if (details.streamUrl) g.streamUrl = details.streamUrl;
         if (details.roundScore) g.score = `${g.score} (Map: ${details.roundScore})`;
     }));

  } catch(e) {}

  const deduped = [...new Map(allGames.map((g) => [g.matchId, g])).values()];
  if (!deduped.length) return { games:[], upcoming:[], warning: 'Could not scrape live data' };
  
  deduped.sort((a, b) => (isLiveStr(a.status)?0:1) - (isLiveStr(b.status)?0:1));
  return { games: deduped, upcoming: deduped.filter((g) => g.status !== 'Live').slice(0, 10), warning: null };
}

'@
$Content = $Content -replace $oldVlrData, $newVlrData

# =====================================================================
# PHASE 4: Write Output to Disk
# =====================================================================
$Content | Set-Content -Path $FilePath -NoNewline

Write-Output "Remediation complete. JSDOM has been removed and Vercel functions should now respond instantly."