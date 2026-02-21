const gameStartCache = new Map();
// lib/providers.js

const UPCOMING_WINDOW_MS = 72 * 60 * 60 * 1000; // 3-day look-ahead
const STALE_CUTOFF_MS    =  6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS   = 5000;

// === NBA ===
const NBA_URL          = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// === LoL Riot API ===
const LOL_API_KEY      = process.env.LOL_API_KEY || process.env.RIOT_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_SCHEDULE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const LOL_LIVE_URL     = 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US';

const LOL_REGIONS = [
  { key: 'LCS',       leagueId: '98767991299243165' },
  { key: 'LEC',       leagueId: '98767991302996019' },
  { key: 'LPL',       leagueId: '98767991314006698' },
  { key: 'LCK',       leagueId: '98767991310872058' },
  { key: 'CBLOL',     leagueId: '98767991332355509' },
  { key: 'LTA South', leagueId: '113475181634818701' },
  { key: 'LTA North', leagueId: '113475185966427351' },
  { key: 'LCP',       leagueId: '113475204423853000' },
];

// === CS2 - ordered by reliability ===
const CS_SOURCES = [
  'https://hltv-api-rust.vercel.app/api/matches',
  'https://hltv-api-py.vercel.app/api/matches',
  'https://hltv-api-steel.vercel.app/api/matches',
  'https://hltv-api.vercel.app/api/matches.json',
];

const TEAM_ALIASES = {
  ATL:['atl','hawks'], BOS:['bos','celtics'], BKN:['bkn','nets'], CHA:['cha','hornets'], CHI:['chi','bulls'],
  CLE:['cle','cavs'], DAL:['dal','mavs'], DEN:['den','nuggets'], DET:['det','pistons'], GSW:['gsw','warriors'],
  HOU:['hou','rockets'], IND:['ind','pacers'], LAC:['lac','clippers'], LAL:['lal','lakers'], MEM:['mem','grizzlies'],
  MIA:['mia','heat'], MIL:['mil','bucks'], MIN:['min','wolves'], NOP:['nop','pelicans'], NYK:['nyk','knicks'],
  OKC:['okc','thunder'], ORL:['orl','magic'], PHI:['phi','76ers'], PHX:['phx','suns'], POR:['por','blazers'],
  SAC:['sac','kings'], SAS:['sas','spurs'], TOR:['tor','raptors'], UTA:['uta','jazz'], WAS:['was','wizards']
};

const normalize   = (v = '') => String(v).toLowerCase().trim();
const unique      = (a) => [...new Set(a)];
const parseDate   = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
const inNextXh    = (ts) => ts && ts >= Date.now() && ts <= Date.now() + UPCOMING_WINDOW_MS;
const inNext12h   = inNextXh;
const isLiveStr   = (s = '') => /\b(live|inprogress|in.?progress|ongoing)\b/i.test(s);
const isCompleted = (s = '') => /\b(completed?|finished?|over|final|ended?)\b/i.test(s);

// Decode HTML entities so "&ndash;" shows as "-" not as literal text
function decodeHtml(s) {
  return String(s || '')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, '');
}

function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, cleanup: () => clearTimeout(id) };
}

async function fetchJson(url, options = {}) {
  const { controller, cleanup } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: 'no-store', signal: controller.signal, ...options,
      headers: { 'User-Agent': 'realtimenb/2.0', ...(options.headers || {}) }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally { cleanup(); }
}

async function fetchText(url, options = {}) {
  const { controller, cleanup } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: 'no-store', signal: controller.signal, ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.text();
  } finally { cleanup(); }
}

async function withDeadline(promise, ms, label) {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout`)), ms); })
    ]);
  } finally { clearTimeout(t); }
}

function riotHeaders() {
  return { Accept: 'application/json', Origin: 'https://lolesports.com', 'x-api-key': LOL_API_KEY };
}

function serializeEsport(item) {
  return {
    matchId:     String(item.matchId || item.id || item.label || 'unknown'),
    label:       item.label       || 'TBD vs TBD',
    status:      item.status      || 'Scheduled',
    startTime:   item.startTime   || null,
    league:      decodeHtml(item.league || 'Esports'),
    score:       item.score       || null,
    kills:       item.kills       || null,
    gameTime:    item.gameTime    || null,
    seriesScore: item.seriesScore || null,
    clock:       item.clock       || null,
    streamUrl:   item.streamUrl   || null,
    lastUpdated: new Date().toISOString(),
  };
}

// === NBA ===
function formatNbaTime(str) {
  if (!str) return '';
  const m = str.match(/PT(\d+)M(\d+)(?:\.(\d+))?S/);
  if (m) {
    const [, min, sec, ms] = m;
    const secStr = String(sec).padStart(2, '0');
    // Only show decimals if non-zero - prevents "4:43.00" from CDN source
    if (ms && ms.replace(/0/g, '') !== '') return `${min}:${secStr}.${ms.slice(0, 2)}`;
    return `${min}:${secStr}`;
  }
  // ESPN sends plain "4:43" - pass through unchanged
  if (/^\d+:\d+$/.test(str.trim())) return str.trim();
  if (/\d/.test(str)) return str;
  return '';
}

const formatClock = (period, clock) => {
  if (!period || period === 0) return '';
  const timeStr = formatNbaTime(clock);
  return `${period > 4 ? `OT${period - 4}` : `Q${period}`} ${timeStr || '0:00'}`;
};

function serializeNbaFromCdn(game) {
  const sCode = game.gameStatus;
  let status = 'Scheduled';
  let clock  = '';
  if (sCode === 3) {
    status = 'Final'; clock = 'Final';
  } else if (sCode === 2) {
    status = 'Live';
    const text = game.gameStatusText || '';
    if (/Halftime|Half/i.test(text)) clock = 'Halftime';
    else if (/End\s+of/i.test(text)) clock = text;
    else clock = formatClock(game.period, game.gameClock);
  }
  const start = game.gameTimeUTC || game.gameEt || null;
  return {
    gameId: game.gameId,
    label: `${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}`,
    status, clock,
    home: { code: game.homeTeam.teamTricode, name: game.homeTeam.teamName, city: game.homeTeam.teamCity, score: Number(game.homeTeam.score) },
    away: { code: game.awayTeam.teamTricode, name: game.awayTeam.teamName, city: game.awayTeam.teamCity, score: Number(game.awayTeam.score) },
    startTime: start, lastUpdated: new Date().toISOString()
  };
}

function serializeNbaFromEspn(event) {
  const comp  = event.competitions?.[0] || {};
  const teams = comp.competitors || [];
  const away  = teams.find(t => t.homeAway === 'away') || teams[0] || {};
  const home  = teams.find(t => t.homeAway === 'home') || teams[1] || {};
  const state = comp.status?.type?.state;
  let status = 'Scheduled', clock = '';
  if (state === 'post') {
    status = 'Final'; clock = 'Final';
  } else if (state === 'in') {
    status = 'Live';
    clock = formatClock(comp.status?.period || 1, comp.status?.displayClock);
    if (/Half/i.test(comp.status?.type?.description || '')) clock = 'Halftime';
  }
  return {
    gameId: event.id,
    label: `${away.team?.abbreviation || 'AWAY'} @ ${home.team?.abbreviation || 'HOME'}`,
    status, clock,
    home: { code: home.team?.abbreviation || 'HOME', name: home.team?.name || 'Home', city: home.team?.location || '', score: Number(home.score || 0) },
    away: { code: away.team?.abbreviation || 'AWAY', name: away.team?.name || 'Away', city: away.team?.location || '', score: Number(away.score || 0) },
    startTime: event.date || null, lastUpdated: new Date().toISOString()
  };
}

async function getNbaData() {
  const tasks = [
    fetchJson(NBA_URL).then(p => ({ games: (p?.scoreboard?.games || []).map(serializeNbaFromCdn) })),
    fetchJson(NBA_FALLBACK_URL).then(p => ({ games: (p?.events || []).map(serializeNbaFromEspn) }))
  ];
  const result = await Promise.any(tasks.map(t => t.catch(e => { throw e; }))).catch(() => null);
  if (!result?.games?.length) return { games: [], upcoming: [], warning: null };
  return {
    games: result.games,
    upcoming: result.games
      .filter(g => inNext12h(parseDate(g.startTime)))
      .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
    warning: null
  };
}

// === LoL ===
async function fetchLolLive() {
  try {
    const p = await withDeadline(fetchJson(LOL_LIVE_URL, { headers: riotHeaders() }), 4000, 'getLive');
    const liveEvents = [];
    for (const ev of p?.data?.schedule?.events || []) {
      if (isLiveStr(ev.state)) {
        liveEvents.push(ev);
      }
    }
    return liveEvents;
  } catch { return []; }
}

async function fetchLolStats(gameId) {
  try {
    const winData = await fetchJson('https://feed.lolesports.com/livestats/v1/window/' + gameId).catch(() => null);
    if (!winData || !winData.frames || !winData.frames.length) return { error: 'No live window' };

    // 1. Fix the "Stuck at 0:05" bug
    // Stream the details endpoint just enough to grab the true game start time.
    // This prevents massive JSON timeout issues in serverless.
    if (!gameStartCache.has(gameId)) {
        try {
            const res = await fetch('https://feed.lolesports.com/livestats/v1/details/' + gameId);
            if (res.ok && res.body) {
                let chunkStr = '';
                for await (const chunk of res.body) {
                    chunkStr += chunk.toString();
                    const match = chunkStr.match(/"rfc460Timestamp"\s*:\s*"([^"]+)"/);
                    if (match) {
                        gameStartCache.set(gameId, new Date(match[1]).getTime());
                        if (typeof res.body.destroy === 'function') res.body.destroy();
                        if (typeof res.body.cancel === 'function') res.body.cancel();
                        break;
                    }
                    if (chunkStr.length > 200000) break;
                }
            }
        } catch(e) {}
        
        if (!gameStartCache.has(gameId)) {
            gameStartCache.set(gameId, new Date(winData.frames[0].rfc460Timestamp).getTime());
        }
    }

    const frames = winData.frames;
    const lastTimeFrame = frames[frames.length - 1];
    
    // 2. Fix the "Kills are 0 - 0" bug
    // Scan backwards for the last frame that actually contains game state.
    // Riot often sends empty "heartbeat" frames at the end of the array.
    const stateFrame = frames.slice().reverse().find(f => f.blueTeam || (f.participants && f.participants.length > 0)) || lastTimeFrame;

    const start = gameStartCache.get(gameId);
    const end = new Date(lastTimeFrame.rfc460Timestamp).getTime();
    let diff = end - start;
    
    let clock = 'LIVE';
    if (diff >= 0) {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      clock = m + ':' + String(s).padStart(2, '0');
    }

    let k1 = 0, k2 = 0;
    if (stateFrame.blueTeam) {
        k1 = stateFrame.blueTeam.totalKills ?? stateFrame.blueTeam.kills ?? 0;
        k2 = stateFrame.redTeam?.totalKills ?? stateFrame.redTeam?.kills ?? 0;
    } else if (stateFrame.participants && stateFrame.participants.length >= 10) {
        k1 = stateFrame.participants.slice(0, 5).reduce((sum, p) => sum + (p.kills || 0), 0);
        k2 = stateFrame.participants.slice(5, 10).reduce((sum, p) => sum + (p.kills || 0), 0);
    }

    return { k1, k2, clock };
  } catch (err) {
    return { error: 'Fetch failed: ' + err.message };
  }
}
async function getLolData() {
  const allGames = [];
  const [settled, liveEvents] = await Promise.all([
    Promise.allSettled(
      LOL_REGIONS.map(r =>
        fetchJson(`${LOL_SCHEDULE_URL}&leagueId=${r.leagueId}`, { headers: riotHeaders() })
          .then(p => ({ region: r, events: p?.data?.schedule?.events || [] }))
      )
    ),
    fetchLolLive()
  ]);

  for (const result of settled) {
    if (result.status === 'rejected') continue;
    for (const e of result.value.events) {
      if (isCompleted(e.state)) continue;

      const eStart      = parseDate(e.startTime);
      const matchedLive = liveEvents.find(lev =>
        lev.id === e.id ||
        (lev.league?.id === result.value.region.leagueId && Math.abs((parseDate(lev.startTime)||0) - eStart) < 20 * 60 * 1000)
      );
      const isLive = !!matchedLive || isLiveStr(e.state);
      const teams  = e.match?.teams || [];

      let w1 = 0, w2 = 0;
      if (e.match?.games?.length) {
        for (const g of e.match.games) {
          if (g.state === 'completed') {
            const winnerId = g.teams?.find(t => t.result?.outcome === 'win')?.id;
            if (winnerId && teams[0]?.id === winnerId) w1++;
            else if (winnerId && teams[1]?.id === winnerId) w2++;
          }
        }
      } else {
        w1 = teams[0]?.result?.gameWins ?? 0;
        w2 = teams[1]?.result?.gameWins ?? 0;
      }

      const strategyCount = e.match?.strategy?.count; const totalGames = strategyCount || (e.match?.games || []).length || 1;
      const seriesType  = totalGames >= 5 ? 'Bo5' : totalGames >= 3 ? 'Bo3' : 'Bo1';
      const seriesScore = `${seriesType}: ${w1}-${w2}`;

      let score    = `${w1}-${w2}`;
      let clock    = null;
      let kills    = null;
      let gameTime = null;

      if (isLive) {
        const gameList = (matchedLive?.match?.games?.length ? matchedLive.match.games : e.match?.games) || [];
        const activeGame = gameList.find(g => g.state === 'inProgress') || gameList.find(g => g.state !== 'completed');
        if (!activeGame) {
          gameTime = "Live API syncing...";
        } else if (activeGame.id) {
          const stats = await fetchLolStats(activeGame.id);
          if (stats && stats.error) {
            gameTime = `[DEBUG] ${stats.error}`;
            clock = 'Error';
          } else if (stats) {
            const gameNum = gameList.findIndex(g => g.id === activeGame.id) + 1;
            const t1code = teams[0]?.code || teams[0]?.name?.substring(0,3).toUpperCase() || 'BLU';
            const t2code = teams[1]?.code || teams[1]?.name?.substring(0,3).toUpperCase() || 'RED';
            kills = `${t1code} ${stats.k1} - ${stats.k2} ${t2code}`;
            gameTime = `Game ${gameNum} \u2022 ${stats.clock}`;
            clock = stats.clock;
          }
        }
      }
allGames.push(serializeEsport({
        matchId:   e.id,
        label:     `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status:    isLive ? 'Live' : (e.state || 'Scheduled'),
        startTime: e.startTime || null,
        league:    e.league?.name || `LoL ${result.value.region.key}`,
        score, clock, kills, gameTime, seriesScore,
      }));
    }
  }

  const deduped = [...new Map(allGames.map(g => [g.matchId, g])).values()].sort((a, b) => {
    const aL = isLiveStr(a.status) ? 0 : 1, bL = isLiveStr(b.status) ? 0 : 1;
    if (aL !== bL) return aL - bL;
    return (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity);
  });

  if (!deduped.length) return { games: [], upcoming: [], warning: null };
  return {
    games:    deduped,
    upcoming: deduped
      .filter(g => inNextXh(parseDate(g.startTime)))
      .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
    warning: null
  };
}

// === VALORANT ===
// Primary: vlrggapi.vercel.app REST  |  Fallback: vlr.gg HTML scrape

async function getValorantData() {
  // PRIMARY: community REST wrapper
  try {
    const VLR_API = 'https://vlrggapi.vercel.app';
    const [liveRes, upRes] = await Promise.all([
      fetchJson(VLR_API + '/match?q=live_score'),
      fetchJson(VLR_API + '/match?q=upcoming'),
    ]);

    const all = [];
    const now = new Date();

    for (const seg of liveRes?.data?.segments || []) {
      const t1 = seg.team1 || seg.team1_name || seg.team_1 || '';
      const t2 = seg.team2 || seg.team2_name || seg.team_2 || '';
      if (!t1 || !t2) continue;
      const s1 = seg.score1 ?? seg.map_score_1 ?? seg.team1_score ?? '-';
      const s2 = seg.score2 ?? seg.map_score_2 ?? seg.team2_score ?? '-';
      const id = String(seg.match_page || seg.id || (t1 + t2)).replace(/[^\w-]/g, '-');
      all.push(serializeEsport({
        matchId:   'vlr-live-' + id,
        label:     t1 + ' vs ' + t2,
        status:    'Live',
        startTime: now.toISOString(),
        league:    seg.match_event || seg.event || seg.tournament || 'VALORANT',
        score:     s1 + '-' + s2,
        clock:     'LIVE',
        streamUrl: seg.twitch || seg.stream || null,
      }));
    }

    for (const seg of upRes?.data?.segments || []) {
      const t1 = seg.team1 || seg.team1_name || seg.team_1 || '';
      const t2 = seg.team2 || seg.team2_name || seg.team_2 || '';
      if (!t1 || !t2) continue;
      const id  = String(seg.match_page || seg.id || (t1 + t2)).replace(/[^\w-]/g, '-');
      const eta = String(seg.time_until_match || seg.eta || '');
      let startTime = null;
      if (seg.unix_timestamp) {
        startTime = new Date(Number(seg.unix_timestamp) * 1000).toISOString();
      } else {
        const hr  = eta.match(/in\s+(\d+)\s*h/i);
        const min = eta.match(/in\s+(\d+)\s*m/i);
        if (hr)  startTime = new Date(Date.now() + parseInt(hr[1])  * 3600000).toISOString();
        if (min) startTime = new Date(Date.now() + parseInt(min[1]) *   60000).toISOString();
      }
      all.push(serializeEsport({
        matchId:   'vlr-up-' + id,
        label:     t1 + ' vs ' + t2,
        status:    'Scheduled',
        startTime: startTime || new Date(Date.now() + 3600000).toISOString(),
        league:    seg.match_event || seg.event || seg.tournament || 'VALORANT',
        score:     null,
        clock:     eta || null,
        streamUrl: null,
      }));
    }

    if (all.length && all.some(g => g.label !== 'TBD vs TBD')) {
      return {
        games:    all,
        upcoming: all.filter(g => !isLiveStr(g.status)).slice(0, 10),
        warning:  null,
      };
    }
  } catch { /* fall through to scraper */ }

  // FALLBACK: scrape vlr.gg directly
  const allGames = [];
  try {
    const text   = await fetchText('https://www.vlr.gg/matches');
    const blocks = text.match(/<a[^>]+href="\/(\d+)\/[^"]*"[^>]*class="[^"]*match-item[^"]*"[\s\S]*?<\/a>/g) || [];
    const now    = new Date();

    for (const block of blocks) {
      const idM = block.match(/href="\/(\d+)\//);
      if (!idM) continue;
      const id = idM[1];

      const teamMatches = [...block.matchAll(/<div[^>]+class="[^"]*match-item-vs-team-name[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
      const t1 = teamMatches[0] ? teamMatches[0][1].replace(/<[^>]+>/g, '').trim() : 'TBD';
      const t2 = teamMatches[1] ? teamMatches[1][1].replace(/<[^>]+>/g, '').trim() : 'TBD';

      const statusM   = block.match(/<div[^>]+class="[^"]*ml-status[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/);
      const rawStatus = statusM ? statusM[1].trim() : '';
      const isLive    = rawStatus.toLowerCase() === 'live';

      const scoreMs = [...block.matchAll(/<div[^>]+class="[^"]*match-item-vs-team-score[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/g)];
      const s1 = scoreMs[0] ? scoreMs[0][1].trim() : '0';
      const s2 = scoreMs[1] ? scoreMs[1][1].trim() : '0';

      const evM    = block.match(/<div[^>]+class="[^"]*match-item-event[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      const league = decodeHtml(evM ? evM[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim() : 'VALORANT');

      allGames.push(serializeEsport({
        matchId:   'vlr-' + id,
        label:     t1 + ' vs ' + t2,
        status:    isLive ? 'Live' : 'Scheduled',
        startTime: isLive ? now.toISOString() : new Date(Date.now() + 3600000).toISOString(),
        league,
        score:     s1 + '-' + s2,
        clock:     isLive ? 'LIVE' : rawStatus,
        streamUrl: null,
      }));
    }
  } catch { /* no data */ }

  const deduped = [...new Map(allGames.map(g => [g.matchId, g])).values()];
  if (!deduped.length) return { games: [], upcoming: [], warning: 'Could not load VALORANT data' };
  deduped.sort((a, b) => (isLiveStr(a.status) ? 0 : 1) - (isLiveStr(b.status) ? 0 : 1));
  return { games: deduped, upcoming: deduped.filter(g => !isLiveStr(g.status)).slice(0, 10), warning: null };
}

// === CS2 ===
function mapCsMatch(item = {}) {
  const teams = Array.isArray(item.teams) ? item.teams : [];
  const t1    = item.team1?.name || item.team1 || teams[0]?.name || 'TBD';
  const t2    = item.team2?.name || item.team2 || teams[1]?.name || 'TBD';
  let startTime = null;
  for (const k of ['date_unix', 'unix', 'time', 'startTime', 'date']) {
    if (item[k]) {
      const n = Number(item[k]);
      startTime = new Date(Number.isFinite(n) ? n * (n > 1e11 ? 1 : 1000) : item[k]).toISOString();
      break;
    }
  }
  const statusStr = String(item.status || (item.live ? 'Live' : 'Scheduled'));
  const live      = (item.live || isLiveStr(statusStr)) && !isCompleted(statusStr);
  return serializeEsport({
    matchId: String(item.id || `${t1}-${t2}`),
    label:   `${t1} vs ${t2}`,
    status:  live ? 'Live' : 'Scheduled',
    startTime,
    league:  item.event?.name || item.tournament?.name || 'Counter-Strike',
  });
}

// bo3.gg JSON API - fallback when HLTV mirrors are all down
async function getCsDataFromBo3() {
  const all  = [];
  const urls = [
    'https://api.bo3.gg/api/v1/matches?filter[status]=live',
    'https://api.bo3.gg/api/v1/matches?filter[status]=upcoming&page[size]=20',
    'https://bo3.gg/api/v1/matches?filter[status]=live',
    'https://bo3.gg/api/v1/matches?filter[status]=upcoming&page[size]=20',
  ];
  for (const url of urls) {
    try {
      const p     = await fetchJson(url);
      const items = Array.isArray(p) ? p : (p?.data || p?.matches || []);
      for (const item of items) {
        const t1 = item.firstRoster?.name  || item.team1?.name || item.team1 || 'TBD';
        const t2 = item.secondRoster?.name || item.team2?.name || item.team2 || 'TBD';
        if (t1 === 'TBD' && t2 === 'TBD') continue;
        const raw  = String(item.status || '');
        const live = raw === 'live' || isLiveStr(raw);
        let startTime = null;
        for (const k of ['startedAt', 'scheduledAt', 'date', 'startTime']) {
          if (item[k]) { startTime = new Date(item[k]).toISOString(); break; }
        }
        const s1 = item.firstRosterScore  ?? null;
        const s2 = item.secondRosterScore ?? null;
        all.push(serializeEsport({
          matchId:   String(item.id || item.slug || (t1 + t2)),
          label:     `${t1} vs ${t2}`,
          status:    live ? 'Live' : 'Scheduled',
          startTime,
          league:    item.tournament?.name || item.event?.name || 'Counter-Strike',
          score:     s1 != null ? `${s1}-${s2}` : null,
        }));
      }
    } catch { /* try next url */ }
  }
  return all;
}

// PandaScore free public endpoint - last resort CS2 fallback
async function getCsDataFromPanda() {
  const all = [];
  try {
    const [liveData, upData] = await Promise.all([
      fetchJson('https://api.pandascore.co/csgo/matches/running?page[size]=20'),
      fetchJson('https://api.pandascore.co/csgo/matches/upcoming?page[size]=20&sort=begin_at'),
    ]);
    const both = [...(Array.isArray(liveData) ? liveData : []), ...(Array.isArray(upData) ? upData : [])];
    for (const item of both) {
      const t1   = item.opponents?.[0]?.opponent?.name || 'TBD';
      const t2   = item.opponents?.[1]?.opponent?.name || 'TBD';
      if (t1 === 'TBD' && t2 === 'TBD') continue;
      const running = item.status === 'running';
      all.push(serializeEsport({
        matchId:   String(item.id),
        label:     `${t1} vs ${t2}`,
        status:    running ? 'Live' : 'Scheduled',
        startTime: item.begin_at || item.scheduled_at || null,
        league:    item.league?.name || item.tournament?.name || 'Counter-Strike',
        score:     item.results?.length ? `${item.results[0]?.score ?? 0}-${item.results[1]?.score ?? 0}` : null,
      }));
    }
  } catch { /* no data */ }
  return all;
}

async function getCsData() {
  // 1. Try HLTV mirror APIs
  for (const url of CS_SOURCES) {
    try {
      const p     = await fetchJson(url);
      const items = Array.isArray(p) ? p : (p?.matches || []);
      const games = items
        .map(mapCsMatch)
        .filter(g => !isCompleted(g.status) && (isLiveStr(g.status) || parseDate(g.startTime) > Date.now() - STALE_CUTOFF_MS));
      if (games.length) {
        return {
          games,
          upcoming: games
            .filter(g => !isLiveStr(g.status) && inNextXh(parseDate(g.startTime)))
            .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
          warning: null,
        };
      }
    } catch { /* try next */ }
  }

  // 2. Fallback: bo3.gg
  try {
    const games = await getCsDataFromBo3();
    if (games.length) {
      return {
        games,
        upcoming: games
          .filter(g => !isLiveStr(g.status) && inNextXh(parseDate(g.startTime)))
          .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
        warning: null,
      };
    }
  } catch { /* no data */ }

  // 3. Final fallback: PandaScore (no API key needed for basic data)
  try {
    const games = await getCsDataFromPanda();
    if (games.length) {
      return {
        games,
        upcoming: games
          .filter(g => !isLiveStr(g.status) && inNextXh(parseDate(g.startTime)))
          .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
        warning: null,
      };
    }
  } catch { /* no data */ }

  return { games: [], upcoming: [], warning: 'CS2 live data unavailable' };
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  return events.find(e => {
    const target = normalize(`${e.matchId} ${e.label} ${e.league}`);
    return q.split(/\s+/).every(token => target.includes(token));
  }) || null;
}

function pickNba(games, query) {
  if (!Array.isArray(games)) return null;
  const q = normalize(query);
  if (!games.length) return null;
  if (!q) return games[0];
  const teams = unique(
    Object.entries(TEAM_ALIASES)
      .filter(([c, a]) => unique([c.toLowerCase(), ...a]).some(t => q.includes(t)))
      .map(([c]) => c)
  );
  if (teams.length) {
    const tm = games.find(g => teams.some(t => [g.home.code, g.away.code].includes(t)));
    if (tm) return tm;
  }
  return games.find(g =>
    normalize(`${g.label} ${g.home.city} ${g.home.name} ${g.away.city} ${g.away.name}`).includes(q)
  ) || null;
}

export const PROVIDERS = {
  nba:      { getData: getNbaData,      pick: (data, q) => pickNba(data.games, q) },
  lol:      { getData: getLolData,      pick: (data, q) => pickByQuery(data.games, q) },
  csgo:     { getData: getCsData,       pick: (data, q) => pickByQuery(data.games, q) },
  valorant: { getData: getValorantData, pick: (data, q) => pickByQuery(data.games, q) }
};
export function resolveProvider(sport) { return PROVIDERS[normalize(sport || 'nba')] || null; }
