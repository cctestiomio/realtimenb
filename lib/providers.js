// lib/providers.js
const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const STALE_CUTOFF_MS    =  6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS   = 5000;

// === NBA ===
const NBA_URL          = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// === LoL & VALORANT Riot APIs ===
const LOL_API_KEY      = process.env.LOL_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_SCHEDULE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const LOL_LIVE_URL     = 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US';

const VAL_SCHEDULE_URL = 'https://esports-api.valorantesports.com/persisted/gw/getSchedule?hl=en-US';
const VAL_LIVE_URL     = 'https://esports-api.valorantesports.com/persisted/gw/getLive?hl=en-US';

const LOL_REGIONS = [
  { key: 'LCS', leagueId: '98767991299243165' },
  { key: 'LEC', leagueId: '98767991302996019' },
  { key: 'LPL', leagueId: '98767991314006698' },
  { key: 'LCK', leagueId: '98767991310872058' }
];

const VAL_REGIONS = [
  { key: 'VCT Americas', leagueId: '109511549831443335' },
  { key: 'VCT EMEA', leagueId: '109518549825754244' },
  { key: 'VCT Pacific', leagueId: '109518549825754245' },
  { key: 'VCT CN', leagueId: '111559828453472288' }
];

// === CS2 ===
const CS_SOURCES = [
  'https://hltv-api-steel.vercel.app/api/matches',
  'https://hltv-api.vercel.app/api/matches.json',
  'https://csgo-hltv-api.vercel.app/api/matches',
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
const inNext12h   = (ts) => ts && ts >= Date.now() && ts <= Date.now() + UPCOMING_WINDOW_MS;
const isLiveStr   = (s = '') => /\b(live|inprogress|in.?progress|ongoing)\b/i.test(s);
const isCompleted = (s = '') => /\b(completed?|finished?|over|final|ended?)\b/i.test(s);

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

async function withDeadline(promise, ms, label) {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout`)), ms); })
    ]);
  } finally { clearTimeout(t); }
}

function riotHeaders() { return { Accept:'application/json', Origin:'https://lolesports.com', 'x-api-key': LOL_API_KEY }; }

function serializeEsport(item) {
  return {
    matchId: String(item.matchId || item.id || item.label || 'unknown'),
    label: item.label || 'TBD vs TBD',
    status: item.status || 'Scheduled',
    startTime: item.startTime || null,
    league: item.league || 'Esports',
    score: item.score || null,
    clock: item.clock || null,
    streamUrl: item.streamUrl || null,
    lastUpdated: new Date().toISOString()
  };
}

// === NBA ===
// Parse PT07M18.00S -> 7:18.00
function formatNbaTime(str) {
  if (!str) return '';
  const m = str.match(/PT(\d+)M(\d+)(?:\.(\d+))?S/);
  if (m) {
     const [, min, sec, ms] = m;
     const secStr = String(sec).padStart(2, '0');
     // Keep milliseconds if present (2 digits)
     if (ms) return `${min}:${secStr}.${ms.slice(0, 2)}`;
     return `${min}:${secStr}`;
  }
  return str;
}
const formatClock = (period, clock, fallback) => `${period > 4 ? `OT${period - 4}` : `Q${period || 1}`} \u2022 ${formatNbaTime(clock) || fallback || 'TBD'}`;

function serializeNbaFromCdn(game) {
  return {
    gameId: game.gameId, label: `${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}`, status: game.gameStatusText,
    clock: formatClock(game.period, game.gameClock, game.gameEt),
    home: { code: game.homeTeam.teamTricode, name: game.homeTeam.teamName, city: game.homeTeam.teamCity, score: Number(game.homeTeam.score) },
    away: { code: game.awayTeam.teamTricode, name: game.awayTeam.teamName, city: game.awayTeam.teamCity, score: Number(game.awayTeam.score) },
    startTime: game.gameEt || null, lastUpdated: new Date().toISOString()
  };
}
function serializeNbaFromEspn(event) {
  const comp = event.competitions?.[0] || {}; const teams = comp.competitors || [];
  const away = teams.find((t) => t.homeAway === 'away') || teams[0] || {};
  const home = teams.find((t) => t.homeAway === 'home') || teams[1] || {};
  return {
    gameId: event.id, label: `${away.team?.abbreviation || 'AWAY'} @ ${home.team?.abbreviation || 'HOME'}`,
    status: comp.status?.type?.description || 'Scheduled', clock: formatClock(comp.status?.period || 1, comp.status?.displayClock, event.date),
    home: { code: home.team?.abbreviation || 'HOME', name: home.team?.name || 'Home', city: home.team?.location || '', score: Number(home.score || 0) },
    away: { code: away.team?.abbreviation || 'AWAY', name: away.team?.name || 'Away', city: away.team?.location || '', score: Number(away.score || 0) },
    startTime: event.date || null, lastUpdated: new Date().toISOString()
  };
}
async function getNbaData() {
  const errors = [];
  const tasks = [
    fetchJson(NBA_URL).then((p) => ({ source:'nba', games:(p?.scoreboard?.games||[]).map(serializeNbaFromCdn) })),
    fetchJson(NBA_FALLBACK_URL).then((p) => ({ source:'espn', games:(p?.events||[]).map(serializeNbaFromEspn) }))
  ];
  const result = await Promise.any(tasks.map((t) => t.catch((e) => { errors.push(e.message); throw e; }))).catch(() => null);
  if (!result?.games?.length) return { games: [], upcoming: [], warning: null };
  return { games: result.games, upcoming: result.games.filter((g) => inNext12h(parseDate(g.startTime))).sort((a, b) => (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER)), warning: null };
}

// === LoL ===
async function fetchLolLive() {
  try {
    const p = await withDeadline(fetchJson(LOL_LIVE_URL, { headers: riotHeaders() }), 4000, 'getLive');
    const liveEvents = [];
    for (const ev of p?.data?.schedule?.events || []) {
      if (isLiveStr(ev.state)) {
          liveEvents.push({
              id: ev.id,
              startTime: parseDate(ev.startTime),
              leagueId: ev.league?.id
          });
      }
    }
    return liveEvents;
  } catch { return []; }
}

async function fetchLolStats(gameId) {
  try {
    const winData = await fetchJson(`https://feed.lolesports.com/livestats/v1/window/${gameId}`, { headers: riotHeaders() });
    const frames = winData?.frames || [];
    if (!frames.length) return null;

    const last = frames[frames.length - 1];
    const k1 = last.blueTeam?.totalKills ?? 0;
    const k2 = last.redTeam?.totalKills ?? 0;

    const start = new Date(frames[0].rfc460Timestamp).getTime();
    const end = new Date(last.rfc460Timestamp).getTime();
    const diff = end - start;
    let clock = 'Live';

    if (diff >= 0) {
       const m = Math.floor(diff / 60000);
       const s = Math.floor((diff % 60000) / 1000);
       clock = `${m}:${String(s).padStart(2, '0')}`;
    }
    return { k1, k2, clock };
  } catch { return null; }
}

async function getLolData() {
  const allGames = [];
  const [settled, liveEvents] = await Promise.all([
    Promise.allSettled(LOL_REGIONS.map((r) => fetchJson(`${LOL_SCHEDULE_URL}&leagueId=${r.leagueId}`, { headers: riotHeaders() }).then((p) => ({ region: r, events: p?.data?.schedule?.events || [] })))),
    fetchLolLive()
  ]);

  for (const result of settled) {
    if (result.status === 'rejected') continue;
    for (const e of result.value.events) {
      if (isCompleted(e.state)) continue;

      const eStart = parseDate(e.startTime);
      // Match by ID or by strict time proximity (within 20 mins) + League check
      const matchedLive = liveEvents.find(lev =>
          lev.id === e.id ||
          (lev.leagueId === result.value.region.leagueId && Math.abs(lev.startTime - eStart) < 20 * 60 * 1000)
      );

      const isLive = !!matchedLive || isLiveStr(e.state);
      const teams = e.match?.teams || [];

      // Calculate series score from games if available, fallback to result
      let w1 = teams[0]?.result?.gameWins ?? 0;
      let w2 = teams[1]?.result?.gameWins ?? 0;

      if (e.match?.games?.length) {
         let gw1 = 0, gw2 = 0;
         let hasCompleted = false;
         for (const g of e.match.games) {
            if (g.state === 'completed') {
               hasCompleted = true;
               const winnerId = g.teams?.find(t => t.result?.outcome === 'win')?.id;
               if (winnerId && teams[0]?.id === winnerId) gw1++;
               else if (winnerId && teams[1]?.id === winnerId) gw2++;
            }
         }
         if (hasCompleted) { w1 = gw1; w2 = gw2; }
      }

      let score = `${w1}-${w2}`;
      let clock = null;

      if (isLive) {
         // Find active game to fetch stats
         const activeGame = (e.match?.games || []).find(g => g.state === 'inProgress' || g.state === 'unstarted');
         if (activeGame?.id) {
             const stats = await fetchLolStats(activeGame.id);
             if (stats) {
                 score = `${w1} (K:${stats.k1})|${w2} (K:${stats.k2})`;
                 clock = stats.clock;
             }
         }
      }
      
      allGames.push(serializeEsport({
        matchId: e.id, label: `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status: isLive ? 'Live' : (e.state || 'Scheduled'), startTime: e.startTime || null,
        league: e.league?.name || `LoL ${result.value.region.key}`, score, clock
      }));
    }
  }

  const deduped = [...new Map(allGames.map((g) => [g.matchId, g])).values()].sort((a, b) => {
    const aL = isLiveStr(a.status) ? 0 : 1, bL = isLiveStr(b.status) ? 0 : 1;
    if (aL !== bL) return aL - bL;
    return (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER);
  });
  
  if (!deduped.length) {
    return { games:[], upcoming:[], warning: null };
  }
  return { games: deduped, upcoming: deduped.filter((g) => inNext12h(parseDate(g.startTime))).sort((a, b) => (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER)), warning: null };
}

// === VALORANT (Real Riot API) ===
async function getValorantData() {
  const allGames = [];
  const liveSet = new Set();
  
  // Realtime Live status from Riot
  try {
     const liveReq = await withDeadline(fetchJson(VAL_LIVE_URL, { headers: riotHeaders() }), 4000, 'valLive');
     for (const ev of liveReq?.data?.schedule?.events || []) {
        if (ev?.id && isLiveStr(ev.state)) liveSet.add(ev.id);
     }
  } catch(e) {}

  const settled = await Promise.allSettled(VAL_REGIONS.map((r) => fetchJson(`${VAL_SCHEDULE_URL}&leagueId=${r.leagueId}`, { headers: riotHeaders() }).then((p) => ({ region: r, events: p?.data?.schedule?.events || [] }))));

  for (const result of settled) {
    if (result.status === 'rejected') continue;
    for (const e of result.value.events) {
      if (isCompleted(e.state)) continue;
      const teams = e.match?.teams || [];
      const isLive = (liveSet.has(e.id) || isLiveStr(e.state)) && !isCompleted(e.state);
      
      allGames.push(serializeEsport({
        matchId: e.id, label: `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status: isLive ? 'Live' : 'Scheduled', startTime: e.startTime || null,
        league: e.league?.name || result.value.region.key,
        score: isLive ? `${teams[0]?.result?.gameWins ?? 0}-${teams[1]?.result?.gameWins ?? 0}` : null
      }));
    }
  }

  const deduped = [...new Map(allGames.map((g) => [g.matchId, g])).values()].sort((a, b) => {
    const aL = isLiveStr(a.status) ? 0 : 1, bL = isLiveStr(b.status) ? 0 : 1;
    if (aL !== bL) return aL - bL;
    return (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER);
  });

  if (!deduped.length) {
    return { games:[], upcoming:[], warning: null };
  }
  return { games: deduped, upcoming: deduped.filter((g) => inNext12h(parseDate(g.startTime))).sort((a, b) => (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER)), warning: null };
}

// === CS2 ===
function mapCsMatch(item = {}) {
  const teams = Array.isArray(item.teams) ? item.teams : [];
  const t1 = (item.team1?.name || item.team1 || teams[0]?.name || 'TBD');
  const t2 = (item.team2?.name || item.team2 || teams[1]?.name || 'TBD');
  let startTime = null;
  for (const k of ['date_unix','unix','time','startTime','date']) { if (item[k]) { startTime = new Date(Number.isFinite(Number(item[k])) ? Number(item[k])*(item[k]>1e11?1:1000) : item[k]).toISOString(); break; } }

  const statusStr = String(item.status || (item.live ? 'Live' : 'Scheduled'));
  const isLive = (item.live || isLiveStr(statusStr)) && !isCompleted(statusStr);

  return serializeEsport({ matchId: String(item.id||`${t1}-${t2}`), label: `${t1} vs ${t2}`, status: isLive ? 'Live' : 'Scheduled', startTime, league: item.event?.name || 'Counter-Strike' });
}
async function getCsData() {
  for (const url of CS_SOURCES) {
    try {
      const p = await fetchJson(url); const items = Array.isArray(p) ? p : p?.matches || [];
      const games = items.map(mapCsMatch).filter(g => isLiveStr(g.status) || (parseDate(g.startTime) > Date.now() - STALE_CUTOFF_MS));
      // Double check completed status filtering
      const validGames = games.filter(g => !isCompleted(g.status) && !/\b(final|finished)\b/i.test(g.status));
      if (validGames.length) return { games: validGames, upcoming: validGames.filter((g) => inNext12h(parseDate(g.startTime))).sort((a, b) => (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER)), warning: null };
    } catch {}
  }
  return { games:[], upcoming:[], warning: null };
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  return events.find((e) => normalize(`${e.matchId} ${e.label} ${e.league}`).includes(q)) || null;
}
function pickNba(games, query) {
  const q = normalize(query); if (!games.length) return null; if (!q) return games[0];
  const teams = unique(Object.entries(TEAM_ALIASES).filter(([c, a]) => unique([c.toLowerCase(), ...a]).some((t) => q.includes(t))).map(([c]) => c));
  if (teams.length) { const tm = games.find((g) => teams.some((t) => [g.home.code, g.away.code].includes(t))); if (tm) return tm; }
  return games.find((g) => normalize(`${g.label} ${g.home.city} ${g.home.name} ${g.away.city} ${g.away.name}`).includes(q)) || null;
}

export const PROVIDERS = {
  nba:      { getData: getNbaData,      pick: (data, q) => pickNba(data.games, q) },
  lol:      { getData: getLolData,      pick: (data, q) => pickByQuery(data.games, q) },
  csgo:     { getData: getCsData,       pick: (data, q) => pickByQuery(data.games, q) },
  valorant: { getData: getValorantData, pick: (data, q) => pickByQuery(data.games, q) }
};
export function resolveProvider(sport) { return PROVIDERS[normalize(sport || 'nba')] || null; }

