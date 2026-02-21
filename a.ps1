$ErrorActionPreference = 'Stop'
$file = "lib\providers.js"
Write-Host "Patching $file..." -ForegroundColor Cyan
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

$startStr = "// bo3.gg JSON API - fallback when HLTV mirrors are all down"
$endStr = "function pickByQuery(events, query) {"

$startIdx = $src.IndexOf($startStr)
$endIdx = $src.IndexOf($endStr)

if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
    $oldFunc = $src.Substring($startIdx, $endIdx - $startIdx)
    $newCode = @'
// === CS2 MULTI-FALLBACK ENGINE ===

async function getCsDataFromLiquipedia() {
  const all = [];
  try {
    const html = await fetchText('https://liquipedia.net/counterstrike/Liquipedia:Matches', {
      headers: { 'User-Agent': 'realtimenb/2.0 (github.com/cctestiomio)' }
    });
    const tables = html.match(/<table[^>]*infobox_matches_content[\s\S]*?<\/table>/g) || [];
    const now = Date.now();
    for (const tbl of tables) {
       const t1m = tbl.match(/<td class="team-left"[\s\S]*?<a[^>]*title="([^"]+)"/);
       const t2m = tbl.match(/<td class="team-right"[\s\S]*?<a[^>]*title="([^"]+)"/);
       const timeM = tbl.match(/data-timestamp="(\d+)"/);
       if (t1m && t2m && timeM) {
          const t1 = t1m[1].replace(' (page does not exist)', '');
          const t2 = t2m[1].replace(' (page does not exist)', '');
          const ts = parseInt(timeM[1]) * 1000;
          const isLive = now >= ts && now < ts + (3 * 3600 * 1000);
          
          let league = 'CS2 Match';
          const tourM = tbl.match(/<div class="tourney-text"[^>]*><a[^>]*title="([^"]+)"/);
          if (tourM) league = tourM[1].replace(' (page does not exist)', '');

          all.push(serializeEsport({
             matchId: 'lq-' + ts + '-' + t1.replace(/\s+/g,''),
             label: t1 + ' vs ' + t2,
             status: isLive ? 'Live' : 'Scheduled',
             startTime: new Date(ts).toISOString(),
             league: league
          }));
       }
    }
  } catch {}
  return all;
}

async function getCsDataFromHltvRss() {
  const all = [];
  try {
    const xml = await fetchText('https://www.hltv.org/rss/matches', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g;
    let m;
    const now = Date.now();
    while ((m = itemRegex.exec(xml)) !== null) {
      const title = m[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim();
      const pubDate = m[2].trim();
      if (!title.includes(' vs ')) continue;
      const ts = new Date(pubDate).getTime();
      const isLive = ts <= now && ts > now - (3 * 3600 * 1000);
      all.push(serializeEsport({
        matchId: 'hltvrss-' + ts,
        label: title,
        status: isLive ? 'Live' : 'Scheduled',
        startTime: new Date(ts).toISOString(),
        league: 'CS2 Match'
      }));
    }
  } catch {}
  return all;
}

async function getCsDataFromBo3() {
  const all = [];
  const urls = [
    'https://api.bo3.gg/api/v1/matches?filter[status]=live',
    'https://api.bo3.gg/api/v1/matches?filter[status]=upcoming&page[size]=20'
  ];
  for (const url of urls) {
    try {
      const p = await fetchJson(url, { headers: { 'Accept': 'application/json' } });
      const items = Array.isArray(p) ? p : (p?.data || p?.matches || []);
      for (const item of items) {
        const t1 = item.firstRoster?.name || item.team1?.name || 'TBD';
        const t2 = item.secondRoster?.name || item.team2?.name || 'TBD';
        if (t1 === 'TBD' && t2 === 'TBD') continue;
        const live = String(item.status) === 'live';
        const st = item.startedAt || item.scheduledAt || item.date;
        all.push(serializeEsport({
          matchId: String(item.id || t1+t2),
          label: `${t1} vs ${t2}`,
          status: live ? 'Live' : 'Scheduled',
          startTime: st ? new Date(st).toISOString() : null,
          league: item.tournament?.name || 'CS2 Match'
        }));
      }
    } catch {}
  }
  return all;
}

function processCsGames(games, warningMsg) {
  const valid = games.filter(g => !isCompleted(g.status) && (isLiveStr(g.status) || parseDate(g.startTime) > Date.now() - STALE_CUTOFF_MS));
  if (!valid.length) return null;
  return {
    games: valid,
    upcoming: valid
      .filter(g => !isLiveStr(g.status) && inNextXh(parseDate(g.startTime)))
      .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
    warning: warningMsg
  };
}

async function getCsData() {
  // 1. Try HLTV mirror APIs (often dead/rate-limited)
  for (const url of CS_SOURCES) {
    try {
      const p = await fetchJson(url);
      const items = Array.isArray(p) ? p : (p?.matches || []);
      const games = items.map(mapCsMatch);
      const res = processCsGames(games, null);
      if (res) return res;
    } catch {}
  }

  // 2. Liquipedia Scraper (Very reliable HTML structure)
  const lqGames = await getCsDataFromLiquipedia();
  const lqRes = processCsGames(lqGames, 'Using Liquipedia Fallback');
  if (lqRes) return lqRes;

  // 3. HLTV Official RSS Feed (Bulletproof against Cloudflare)
  const rssGames = await getCsDataFromHltvRss();
  const rssRes = processCsGames(rssGames, 'Using HLTV RSS Fallback');
  if (rssRes) return rssRes;

  // 4. Bo3.gg JSON API
  const bo3Games = await getCsDataFromBo3();
  const bo3Res = processCsGames(bo3Games, 'Using Bo3.gg Fallback');
  if (bo3Res) return bo3Res;

  return { games: [], upcoming: [], warning: 'All CS2 data sources failed to load' };
}

'@
    $src = $src.Replace($oldFunc, $newCode)
    [System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
    Write-Host "-> Successfully patched CS2 Fallbacks!" -ForegroundColor Green
} else {
    Write-Error "Could not find the target CS2 block. Ensure the file hasn't been heavily modified."
}