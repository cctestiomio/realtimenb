// lib/providers.js  (fixed)
// Bullets / special chars use \uXXXX escapes to survive any encoding path.

const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const STALE_CUTOFF_MS    =  6 * 60 * 60 * 1000;  // drop non-live matches >6h old
const FETCH_TIMEOUT_MS   = 5000;

// === NBA ====================================================================
const NBA_URL          = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// === LoL ====================================================================
// Public community API key - same key embedded in every official Riot esports app.
// Not a private secret; safe to include here.
const LOL_API_KEY      = process.env.LOL_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_SCHEDULE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const LOL_LIVE_URL     = 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US';

const LOL_REGIONS = [
  { key: 'LCS', leagueId: '98767991299243165' },
  { key: 'LEC', leagueId: '98767991302996019' },
  { key: 'LPL', leagueId: '98767991314006698' },
  { key: 'LCK', leagueId: '98767991310872058' }
];

const LOL_TWITCH = {
  LCS: 'https://www.twitch.tv/lcs',
  LEC: 'https://www.twitch.tv/lec',
  LPL: 'https://www.twitch.tv/lpl',
  LCK: 'https://www.twitch.tv/lck',
  DEFAULT: 'https://www.twitch.tv/riotgames'
};

// === CS2 ====================================================================
// Multiple mirrors tried in order; freshness-checked (discards stale Oct-2023 data).
const CS_SOURCES = [
  'https://hltv-api-steel.vercel.app/api/matches',
  'https://hltv-api.vercel.app/api/matches.json',
  'https://csgo-hltv-api.vercel.app/api/matches',
];

// === VALORANT ===============================================================
const VAL_LIVE_URL     = 'https://vlrggapi.vercel.app/match?q=live_score';
const VAL_UPCOMING_URL = 'https://vlrggapi.vercel.app/match?q=upcoming';

// === NBA team aliases =======================================================
const TEAM_ALIASES = {
  ATL:['atl','hawks','atlanta'],        BOS:['bos','celtics','boston'],
  BKN:['bkn','nets','brooklyn'],        CHA:['cha','hornets','charlotte'],
  CHI:['chi','bulls','chicago'],        CLE:['cle','cavaliers','cavs','cleveland'],
  DAL:['dal','mavericks','mavs'],       DEN:['den','nuggets','denver'],
  DET:['det','pistons','detroit'],      GSW:['gsw','warriors','golden state'],
  HOU:['hou','rockets','houston'],      IND:['ind','pacers','indiana'],
  LAC:['lac','clippers'],               LAL:['lal','lakers'],
  MEM:['mem','grizzlies','memphis'],    MIA:['mia','heat','miami'],
  MIL:['mil','bucks','milwaukee'],      MIN:['min','timberwolves','wolves'],
  NOP:['nop','pelicans','new orleans'], NYK:['nyk','knicks','new york'],
  OKC:['okc','thunder','oklahoma'],     ORL:['orl','magic','orlando'],
  PHI:['phi','76ers','sixers'],         PHX:['phx','suns','phoenix'],
  POR:['por','blazers','portland'],     SAC:['sac','kings','sacramento'],
  SAS:['sas','spurs','san antonio'],    TOR:['tor','raptors','toronto'],
  UTA:['uta','jazz','utah'],            WAS:['was','wizards','washington']
};

// === Generic helpers ========================================================
const normalize   = (v = '') => String(v).toLowerCase().trim();
const unique      = (a) => [...new Set(a)];
const parseDate   = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
const inNext12h   = (ts) => ts && ts >= Date.now() && ts <= Date.now() + UPCOMING_WINDOW_MS;
const isLiveStr   = (s = '') => /\b(live|inprogress|in.?progress|ongoing)\b/i.test(s);
const isCompleted = (s = '') => /\b(completed?|finished?|over|final|ended?)\b/i.test(s);
const futureIso   = (h) => new Date(Date.now() + h * 3600000).toISOString();

function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, cleanup: () => clearTimeout(id) };
}

async function fetchJson(url, options = {}) {
  const { controller, cleanup } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: 'no-store', signal: controller.signal,
      ...options,
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

// === NBA ====================================================================
const formatClock = (period, clock, fallback) =>
  `${period > 4 ? `OT${period - 4}` : `Q${period || 1}`} \u2022 ${clock || fallback || 'TBD'}`;

function serializeNbaFromCdn(game) {
  return {
    gameId: game.gameId,
    label: `${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}`,
    status: game.gameStatusText,
    clock: formatClock(game.period, game.gameClock, game.gameEt),
    home: { code: game.homeTeam.teamTricode, name: game.homeTeam.teamName, city: game.homeTeam.teamCity, score: Number(game.homeTeam.score) },
    away: { code: game.awayTeam.teamTricode, name: game.awayTeam.teamName, city: game.awayTeam.teamCity, score: Number(game.awayTeam.score) },
    startTime: game.gameEt || null,
    lastUpdated: new Date().toISOString()
  };
}

function serializeNbaFromEspn(event) {
  const comp = event.competitions?.[0] || {};
  const teams = comp.competitors || [];
  const away = teams.find((t) => t.homeAway === 'away') || teams[0] || {};
  const home = teams.find((t) => t.homeAway === 'home') || teams[1] || {};
  return {
    gameId: event.id,
    label: `${away.team?.abbreviation || 'AWAY'} @ ${home.team?.abbreviation || 'HOME'}`,
    status: comp.status?.type?.description || 'Scheduled',
    clock: formatClock(comp.status?.period || 1, comp.status?.displayClock, event.date),
    home: { code: home.team?.abbreviation || 'HOME', name: home.team?.name || 'Home', city: home.team?.location || '', score: Number(home.score || 0) },
    away: { code: away.team?.abbreviation || 'AWAY', name: away.team?.name || 'Away', city: away.team?.location || '', score: Number(away.score || 0) },
    startTime: event.date || null,
    lastUpdated: new Date().toISOString()
  };
}

const fallbackNba = () => [
  { gameId:'demo-nba-1', label:'BOS @ LAL', status:'Demo fallback', clock:'Q1 \u2022 12:00', home:{code:'LAL',name:'Lakers',city:'Los Angeles',score:0}, away:{code:'BOS',name:'Celtics',city:'Boston',score:0}, startTime:futureIso(2), lastUpdated:new Date().toISOString() },
  { gameId:'demo-nba-2', label:'GSW @ DEN', status:'Demo fallback', clock:'Q1 \u2022 12:00', home:{code:'DEN',name:'Nuggets',city:'Denver',score:0}, away:{code:'GSW',name:'Warriors',city:'Golden State',score:0}, startTime:futureIso(4), lastUpdated:new Date().toISOString() }
];

function parseQueryTeams(query) {
  const q = normalize(query);
  if (!q) return [];
  return unique(Object.entries(TEAM_ALIASES)
    .filter(([code, aliases]) => unique([code.toLowerCase(), ...aliases]).some((t) => q.includes(t)))
    .map(([code]) => code));
}

function pickNba(games, query) {
  const q = normalize(query);
  if (!games.length) return null;
  if (!q) return games[0];
  const byId = games.find((g) => normalize(g.gameId) === q);
  if (byId) return byId;
  const teams = parseQueryTeams(q);
  if (teams.length) {
    const tm = games.find((g) => teams.some((t) => [g.home.code, g.away.code].includes(t)));
    if (tm) return tm;
  }
  return games.find((g) => normalize(`${g.label} ${g.home.city} ${g.home.name} ${g.away.city} ${g.away.name}`).includes(q)) || null;
}

async function getNbaData() {
  const errors = [];
  const tasks = [
    fetchJson(NBA_URL).then((p) => ({ source:'nba', games:(p?.scoreboard?.games||[]).map(serializeNbaFromCdn) })),
    fetchJson(NBA_FALLBACK_URL).then((p) => ({ source:'espn', games:(p?.events||[]).map(serializeNbaFromEspn) }))
  ];
  const result = await Promise.any(tasks.map((t) => t.catch((e) => { errors.push(e.message); throw e; }))).catch(() => null);
  if (!result?.games?.length) {
    const games = fallbackNba();
    return { games, upcoming: games.filter((g) => inNext12h(parseDate(g.startTime))), warning:`NBA feeds unavailable: ${errors.join(' | ')}` };
  }
  return { games: result.games, upcoming: result.games.filter((g) => inNext12h(parseDate(g.startTime))), warning: result.source==='espn' ? 'Using ESPN fallback for NBA.' : null };
}

// === LoL ====================================================================
function lolHeaders() {
  return { Accept:'application/json', Origin:'https://lolesports.com', Referer:'https://lolesports.com/', 'x-api-key': LOL_API_KEY };
}

function lolRegionKey(name = '') {
  const n = normalize(name);
  if (n.includes('lcs') || n.includes('north america')) return 'LCS';
  if (n.includes('lec') || n.includes('emea') || n.includes('europe')) return 'LEC';
  if (n.includes('lpl') || n.includes('china')) return 'LPL';
  if (n.includes('lck') || n.includes('korea')) return 'LCK';
  return null;
}

function streamForLol(leagueName, fallbackKey) {
  const k = lolRegionKey(leagueName) || fallbackKey;
  return LOL_TWITCH[k] || LOL_TWITCH.DEFAULT;
}

function serializeEsport(item) {
  return {
    matchId: String(item.matchId || item.id || item.label || 'unknown'),
    label: item.label || 'TBD vs TBD',
    status: item.status || 'Scheduled',
    startTime: item.startTime || null,
    league: item.league || 'Esports',
    score: item.score || null,
    streamUrl: item.streamUrl || null,
    lastUpdated: new Date().toISOString()
  };
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  return events.find((e) => normalize(`${e.matchId} ${e.label} ${e.status} ${e.league}`).includes(q)) || null;
}

async function fetchLolLive() {
  try {
    const p = await withDeadline(fetchJson(LOL_LIVE_URL, { headers: lolHeaders() }), 4000, 'getLive');
    const scoreMap = new Map();
    for (const ev of p?.data?.schedule?.events || []) {
      if (!ev?.id) continue;
      const teams = ev.match?.teams || [];
      scoreMap.set(ev.id, teams.map((t) => t.result?.gameWins ?? 0).join('-'));
    }
    return scoreMap;
  } catch { return new Map(); }
}

// Fetch a single page per region â€” no pagination avoids Vercel cold-start timeouts
async function fetchLolRegion(region) {
  const url = `${LOL_SCHEDULE_URL}&leagueId=${encodeURIComponent(region.leagueId)}`;
  const payload = await withDeadline(
    fetchJson(url, { headers: lolHeaders() }),
    8000, `${region.key} schedule`
  );
  return payload?.data?.schedule?.events || [];
}

async function getLolData() {
  const warnings = [];
  const allGames = [];

  const [settled, liveScores] = await Promise.all([
    Promise.allSettled(LOL_REGIONS.map((r) =>
      fetchLolRegion(r).then((events) => ({ region: r, events }))
    )),
    fetchLolLive()
  ]);

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === 'rejected') {
      warnings.push(`${LOL_REGIONS[i].key}: ${result.reason?.message || 'failed'}`);
      continue;
    }
    const { region, events } = result.value;
    for (const e of events) {
      const state = e.state || '';
      if (isCompleted(state)) continue; // Hide finished games

      const teams      = e.match?.teams || [];
      const leagueName = e.league?.name || `LoL ${region.key}`;
      allGames.push(serializeEsport({
        matchId:   e.id,
        label:     `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status:    isLiveStr(state) ? 'Live' : (state || 'Scheduled'),
        startTime: e.startTime || null,
        league:    leagueName,
        score:     liveScores.get(e.id) || null,
        streamUrl: streamForLol(leagueName, region.key)
      }));
    }
  }

  const deduped = [...new Map(allGames.map((g) => [g.matchId, g])).values()]
    .sort((a, b) => {
      const aL = isLiveStr(a.status) ? 0 : 1, bL = isLiveStr(b.status) ? 0 : 1;
      if (aL !== bL) return aL - bL;
      return (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER);
    });

  if (!deduped.length) {
    const fb = [
      serializeEsport({ matchId:'demo-lol-lck', label:'DRX vs T1',          status:'Demo (API unavailable)', startTime:futureIso(1), league:'LCK', streamUrl:LOL_TWITCH.LCK }),
      serializeEsport({ matchId:'demo-lol-lec', label:'G2 vs FNC',          status:'Demo (API unavailable)', startTime:futureIso(3), league:'LEC', streamUrl:LOL_TWITCH.LEC }),
      serializeEsport({ matchId:'demo-lol-lcs', label:'Team Liquid vs DSG', status:'Demo (API unavailable)', startTime:futureIso(5), league:'LCS', streamUrl:LOL_TWITCH.LCS }),
      serializeEsport({ matchId:'demo-lol-lpl', label:'BLG vs TES',         status:'Demo (API unavailable)', startTime:futureIso(7), league:'LPL', streamUrl:LOL_TWITCH.LPL })
    ];
    return { games:fb, upcoming:fb.filter((g)=>inNext12h(parseDate(g.startTime))), warning:`LoL API unavailable: ${warnings.join(' | ') || 'all regions failed'}` };
  }

  return {
    games:   deduped,
    upcoming: deduped.filter((g) => inNext12h(parseDate(g.startTime))),
    warning: warnings.length ? `Some LoL regions failed: ${warnings.join(' | ')}` : null
  };
}

// === CS2 ====================================================================
function extractTeamName(team) {
  if (!team) return null;
  if (typeof team === 'string') return team.trim() || null;
  return team.name || team.teamName || team.team || team.slug || null;
}

function parseEventStartTime(item) {
  for (const key of ['date_unix','dateUnix','unix','timestamp','startAt']) {
    const num = Number(item[key]);
    if (Number.isFinite(num) && num > 1e9) return new Date(num > 1e12 ? num : num * 1000).toISOString();
  }
  for (const key of ['startTime','date','datetime','time','matchTime']) {
    const v = item[key];
    if (!v) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000).toISOString();
    if (typeof v === 'string') {
      try { return new Date(v.replace(' ', 'T')).toISOString(); } catch { /* skip */ }
    }
  }
  return null;
}

function mapCsMatch(item = {}) {
  const teams = Array.isArray(item.teams) ? item.teams : [];
  const team1 = extractTeamName(item.team1) || extractTeamName(teams[0]) || 'TBD';
  const team2 = extractTeamName(item.team2) || extractTeamName(teams[1]) || 'TBD';
  return serializeEsport({
    matchId:   String(item.id || item.matchId || item.slug || `${team1}-${team2}`),
    label:     `${team1} vs ${team2}`,
    status:    item.status || item.state || (item.live ? 'Live' : 'Scheduled'),
    startTime: parseEventStartTime(item),
    league:    item.event?.name || item.eventName || item.tournament || item.title || 'Counter-Strike'
  });
}

function isStaleCs(game) {
  if (isLiveStr(game.status)) return false;
  const ts = parseDate(game.startTime);
  if (!ts) return true; // No parsable date on a non-live match = skip
  return ts < Date.now() - STALE_CUTOFF_MS;
}

// Discard entire source if the freshest match is >7 days old (broken/cached API)
function isSourceFresh(games) {
  const sevenDays = 7 * 24 * 3600 * 1000;
  return games.some((g) => {
    if (isLiveStr(g.status)) return true;
    const ts = parseDate(g.startTime);
    return ts && ts >= Date.now() - sevenDays;
  });
}

async function getCsFromUrl(url) {
  const payload = await fetchJson(url);
  const items   = Array.isArray(payload) ? payload : payload?.matches || payload?.data || [];
  if (!items.length) throw new Error('empty response');
  const all = items.map(mapCsMatch);
  if (!isSourceFresh(all)) throw new Error('API returning stale data (all matches >7 days old)');
  const fresh = all.filter((g) => !isStaleCs(g));
  if (!fresh.length) throw new Error('no current/upcoming matches found');
  return fresh;
}

async function getCsData() {
  const errors = [];
  for (const url of CS_SOURCES) {
    try {
      const games = await getCsFromUrl(url);
      return { games, upcoming: games.filter((g) => inNext12h(parseDate(g.startTime))), warning: null };
    } catch (err) {
      errors.push(`${url.split('/')[2]}: ${err.message}`);
    }
  }
  const fb = [
    serializeEsport({ matchId:'demo-cs-1', label:'Team Vitality vs Natus Vincere', status:'Demo (API unavailable)', startTime:futureIso(2), league:'Counter-Strike' }),
    serializeEsport({ matchId:'demo-cs-2', label:'FaZe Clan vs G2 Esports',        status:'Demo (API unavailable)', startTime:futureIso(5), league:'Counter-Strike' })
  ];
  return { games:fb, upcoming:fb, warning:`CS2 API unavailable: ${errors.join(' | ')}` };
}

// === VALORANT ===============================================================
// vlrggapi returns unix_timestamp as either:
//   - an integer string like "1708480800" (seconds since epoch)
//   - a date-time string like "2025-02-20 18:00:00" (assumed UTC)
function parseVlrTimestamp(raw) {
  if (!raw) return null;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 1e9) return new Date(num * 1000).toISOString();
  try {
    const s = String(raw).trim().replace(' ', 'T');
    const d = new Date(s.includes('+') || s.endsWith('Z') ? s : s + 'Z');
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch { /* fall through */ }
  return null;
}

function mapVlrMatch(item, forceStatus) {
  const score = (item.score1 != null && item.score2 != null)
    ? `${item.score1}-${item.score2}`
    : item.score || null;
  return serializeEsport({
    matchId:   item.match_page || `${item.team1 || 'tbd'}-${item.team2 || 'tbd'}-${item.unix_timestamp || ''}`,
    label:     `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`,
    status:    forceStatus || item.status || item.time_until_match || 'Scheduled',
    startTime: parseVlrTimestamp(item.unix_timestamp),
    league:    item.tournament_name || item.match_event || 'VALORANT',
    score
  });
}

async function getValorantData() {
  const errors   = [];
  const allGames = [];
  const seen     = new Set();
  const add      = (g) => { if (!seen.has(g.matchId)) { seen.add(g.matchId); allGames.push(g); } };

  const [liveRes, upcomingRes] = await Promise.allSettled([
    fetchJson(VAL_LIVE_URL),
    fetchJson(VAL_UPCOMING_URL)
  ]);

  if (liveRes.status === 'fulfilled') {
    for (const seg of liveRes.value?.data?.segments || []) add(mapVlrMatch(seg, 'Live'));
  } else { errors.push(`live: ${liveRes.reason?.message || 'failed'}`); }

  if (upcomingRes.status === 'fulfilled') {
    for (const seg of upcomingRes.value?.data?.segments || []) add(mapVlrMatch(seg, null));
  } else { errors.push(`upcoming: ${upcomingRes.reason?.message || 'failed'}`); }

  allGames.sort((a, b) => {
    const aL = isLiveStr(a.status) ? 0 : 1, bL = isLiveStr(b.status) ? 0 : 1;
    if (aL !== bL) return aL - bL;
    return (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER);
  });

  if (!allGames.length) {
    const fb = [
      serializeEsport({ matchId:'demo-val-1', label:'Sentinels vs PRX',   status:'Demo (API unavailable)', startTime:futureIso(2), league:'VCT Americas' }),
      serializeEsport({ matchId:'demo-val-2', label:'Team Liquid vs NRG', status:'Demo (API unavailable)', startTime:futureIso(5), league:'VCT EMEA' })
    ];
    return { games:fb, upcoming:fb, warning:`VALORANT API unavailable: ${errors.join(' | ')}` };
  }

  return {
    games:   allGames,
    upcoming: allGames.filter((g) => inNext12h(parseDate(g.startTime))),
    warning: errors.length ? `Some VALORANT feeds failed: ${errors.join(' | ')}` : null
  };
}

// === Exports ================================================================
export const PROVIDERS = {
  nba:      { getData: getNbaData,      pick: (data, q) => pickNba(data.games, q) },
  lol:      { getData: getLolData,      pick: (data, q) => pickByQuery(data.games, q) },
  csgo:     { getData: getCsData,       pick: (data, q) => pickByQuery(data.games, q) },
  valorant: { getData: getValorantData, pick: (data, q) => pickByQuery(data.games, q) }
};

export function resolveProvider(sport) {
  return PROVIDERS[normalize(sport || 'nba')] || null;
}