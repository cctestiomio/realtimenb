const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2200;

const NBA_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const LOL_BASE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const LOL_PAGE_LIMIT = 3;
const LOL_REGIONS = [
  { key: 'LCS', name: 'North America', leagueId: '98767991299243165' },
  { key: 'LEC', name: 'Europe', leagueId: '98767991302996019' },
  { key: 'LPL', name: 'China', leagueId: '98767991314006698' },
  { key: 'LCK', name: 'Korea', leagueId: '98767991310872058' }
];

const LOL_TWITCH_BY_REGION = {
  LCS: 'https://www.twitch.tv/lcs',
  LEC: 'https://www.twitch.tv/lec',
  LPL: 'https://www.twitch.tv/lpl',
  LCK: 'https://www.twitch.tv/lck',
  DEFAULT: 'https://www.twitch.tv/riotgames'
};
const VAL_URL = 'https://vlrggapi.vercel.app/match?q=upcoming';
const CS_URL = 'https://hltv-api.vercel.app/api/matches.json';

const TEAM_ALIASES = {
  ATL: ['atl', 'hawks', 'atlanta'], BOS: ['bos', 'celtics', 'boston'], BKN: ['bkn', 'nets', 'brooklyn'], CHA: ['cha', 'hornets', 'charlotte'],
  CHI: ['chi', 'bulls', 'chicago'], CLE: ['cle', 'cavaliers', 'cavs', 'cleveland'], DAL: ['dal', 'mavericks', 'mavs', 'dallas'], DEN: ['den', 'nuggets', 'denver'],
  DET: ['det', 'pistons', 'detroit'], GSW: ['gsw', 'warriors', 'golden state', 'goldenstate'], HOU: ['hou', 'rockets', 'houston'], IND: ['ind', 'pacers', 'indiana'],
  LAC: ['lac', 'clippers', 'la clippers'], LAL: ['lal', 'lakers', 'la lakers'], MEM: ['mem', 'grizzlies', 'memphis'], MIA: ['mia', 'heat', 'miami'],
  MIL: ['mil', 'bucks', 'milwaukee'], MIN: ['min', 'timberwolves', 'wolves', 'minnesota'], NOP: ['nop', 'pelicans', 'new orleans', 'no'], NYK: ['nyk', 'knicks', 'new york'],
  OKC: ['okc', 'thunder', 'oklahoma city'], ORL: ['orl', 'magic', 'orlando'], PHI: ['phi', '76ers', 'sixers', 'philadelphia'], PHX: ['phx', 'suns', 'phoenix'],
  POR: ['por', 'trail blazers', 'blazers', 'portland'], SAC: ['sac', 'kings', 'sacramento'], SAS: ['sas', 'spurs', 'san antonio'], TOR: ['tor', 'raptors', 'toronto'],
  UTA: ['uta', 'jazz', 'utah'], WAS: ['was', 'wizards', 'washington']
};

const normalize = (v = '') => String(v).toLowerCase().trim();
const unique = (arr) => [...new Set(arr)];
const parseDate = (value) => {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};
const inNext12Hours = (ts) => ts && ts >= Date.now() && ts <= Date.now() + UPCOMING_WINDOW_MS;
const futureIso = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

async function fetchJson(url, options = {}) {
  const { controller, timeout } = withTimeout(FETCH_TIMEOUT_MS);
  const headers = { 'User-Agent': 'realtimenb/1.0', ...(options.headers || {}) };
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      ...options,
      headers
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

let lolApiKeyCache = { value: null, expiresAt: 0 };

async function getLolApiKey() {
  if (lolApiKeyCache.value && lolApiKeyCache.expiresAt > Date.now()) return lolApiKeyCache.value;

  const { controller, timeout } = withTimeout(4000);
  try {
    const response = await fetch('https://lolesports.com/en-US/schedule', {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'realtimenb/1.0' }
    });
    if (!response.ok) return null;
    const html = await response.text();
    const key = html.match(/"apiKey":"([^"]+)"/)?.[1] || html.match(/"ESPORTS_API_KEY":"([^"]+)"/)?.[1] || null;
    if (!key) return null;

    lolApiKeyCache = { value: key, expiresAt: Date.now() + (6 * 60 * 60 * 1000) };
    return key;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function detectLolRegionKey(value = '') {
  const league = normalize(value);
  if (league.includes('lcs') || league.includes('north america') || league.includes('na')) return 'LCS';
  if (league.includes('lec') || league.includes('europe') || league.includes('eu')) return 'LEC';
  if (league.includes('lpl') || league.includes('china') || league.includes('cn')) return 'LPL';
  if (league.includes('lck') || league.includes('korea') || league.includes('kr')) return 'LCK';
  return null;
}

function streamForLolLeague(leagueName, fallbackRegion = null) {
  const key = detectLolRegionKey(leagueName) || fallbackRegion;
  return LOL_TWITCH_BY_REGION[key] || LOL_TWITCH_BY_REGION.DEFAULT;
}


async function withDeadline(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLolRegionEvents(region, lolApiKey) {
  const events = [];
  const seenEvents = new Set();
  const seenTokens = new Set(['']);
  const tokenQueue = [''];

  const requestHeaders = {
    Accept: 'application/json',
    Origin: 'https://lolesports.com',
    Referer: 'https://lolesports.com/',
    ...(lolApiKey ? { 'x-api-key': lolApiKey } : {})
  };

  while (tokenQueue.length && seenTokens.size <= LOL_PAGE_LIMIT) {
    const pageToken = tokenQueue.shift();
    const payload = await withDeadline(
      fetchJson(`${LOL_BASE_URL}&leagueId=${encodeURIComponent(region.leagueId)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
        headers: requestHeaders
      }),
      3000,
      `${region.key} schedule fetch`
    );

    const schedule = payload?.data?.schedule || {};
    const batch = schedule.events || [];
    for (const event of batch) {
      if (!event?.id || seenEvents.has(event.id)) continue;
      if (event?.league?.id && event.league.id !== region.leagueId) continue;
      seenEvents.add(event.id);
      events.push(event);
    }

    for (const nextToken of [schedule?.pages?.older, schedule?.pages?.newer]) {
      if (!nextToken || seenTokens.has(nextToken) || seenTokens.size > LOL_PAGE_LIMIT) continue;
      seenTokens.add(nextToken);
      tokenQueue.push(nextToken);
    }
  }

  return events;
}

function parseQueryTeams(query) {
  const q = normalize(query);
  if (!q) return [];
  const matched = [];
  for (const [code, aliases] of Object.entries(TEAM_ALIASES)) {
    if (unique([code.toLowerCase(), ...aliases]).some((term) => q.includes(term))) matched.push(code);
  }
  return unique(matched);
}

const formatClock = (period, clock, fallback) => `${period > 4 ? `OT${period - 4}` : `Q${period || 1}`} • ${clock || fallback || 'TBD'}`;

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
    status: comp.status?.type?.description || event.status?.type?.description || 'Scheduled',
    clock: formatClock(comp.status?.period || 1, comp.status?.displayClock, event.date),
    home: { code: home.team?.abbreviation || 'HOME', name: home.team?.name || 'Home', city: home.team?.location || '', score: Number(home.score || 0) },
    away: { code: away.team?.abbreviation || 'AWAY', name: away.team?.name || 'Away', city: away.team?.location || '', score: Number(away.score || 0) },
    startTime: event.date || null,
    lastUpdated: new Date().toISOString()
  };
}

const fallbackNbaGames = () => [
  { gameId: 'demo-nba-1', label: 'BOS @ LAL', status: 'Demo fallback (upstream unavailable)', clock: 'Q1 • 12:00', home: { code: 'LAL', name: 'Lakers', city: 'Los Angeles', score: 0 }, away: { code: 'BOS', name: 'Celtics', city: 'Boston', score: 0 }, startTime: futureIso(2), lastUpdated: new Date().toISOString() },
  { gameId: 'demo-nba-2', label: 'GSW @ DEN', status: 'Demo fallback (upstream unavailable)', clock: 'Q1 • 12:00', home: { code: 'DEN', name: 'Nuggets', city: 'Denver', score: 0 }, away: { code: 'GSW', name: 'Warriors', city: 'Golden State', score: 0 }, startTime: futureIso(4), lastUpdated: new Date().toISOString() },
  { gameId: 'demo-nba-3', label: 'LAC @ PHX', status: 'Demo fallback (upstream unavailable)', clock: 'Q1 • 12:00', home: { code: 'PHX', name: 'Suns', city: 'Phoenix', score: 0 }, away: { code: 'LAC', name: 'Clippers', city: 'Los Angeles', score: 0 }, startTime: futureIso(6), lastUpdated: new Date().toISOString() }
];

function pickNba(games, query) {
  const q = normalize(query);
  if (!games.length) return null;
  if (!q) return games[0];
  const byId = games.find((g) => normalize(g.gameId) === q);
  if (byId) return byId;
  const teams = parseQueryTeams(q);
  if (teams.length) {
    const teamMatch = games.find((g) => teams.some((t) => [g.home.code, g.away.code].includes(t)));
    if (teamMatch) return teamMatch;
  }
  return games.find((g) => normalize(`${g.label} ${g.home.city} ${g.home.name} ${g.away.city} ${g.away.name}`).includes(q)) || null;
}


function extractTeamName(team) {
  if (!team) return null;
  if (typeof team === 'string') return team.trim() || null;
  return team.name || team.teamName || team.team || team.slug || null;
}

function parseEventStartTime(item) {
  const direct = item.startTime || item.date || item.datetime || item.time || item.matchTime || null;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    const unix = direct > 1e12 ? direct : direct * 1000;
    return new Date(unix).toISOString();
  }
  if (typeof direct === 'string' && direct.trim()) {
    const trimmed = direct.trim();
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  for (const key of ['date_unix', 'dateUnix', 'unix', 'timestamp', 'startAt']) {
    const raw = item[key];
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      const unix = num > 1e12 ? num : num * 1000;
      return new Date(unix).toISOString();
    }
  }

  return null;
}

function mapCsMatch(item = {}) {
  const teams = Array.isArray(item.teams) ? item.teams : [];
  const team1 = extractTeamName(item.team1) || extractTeamName(teams[0]) || extractTeamName(item.opponent1) || 'TBD';
  const team2 = extractTeamName(item.team2) || extractTeamName(teams[1]) || extractTeamName(item.opponent2) || 'TBD';

  return serializeEsport({
    matchId: String(item.id || item.matchId || item.slug || `${team1}-${team2}-${item.date || ''}`),
    label: `${team1} vs ${team2}`,
    status: item.status || item.state || (item.live ? 'live' : 'scheduled'),
    startTime: parseEventStartTime(item),
    league: item.event?.name || item.eventName || item.tournament || item.title || 'Counter-Strike'
  });
}

function serializeEsport(item, overrides = {}) {
  return {
    matchId: String(item.matchId || item.id || item.slug || item.series || item.label),
    label: item.label || `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`,
    status: item.status || 'Scheduled',
    startTime: item.startTime || null,
    league: item.league || 'Esports',
    score: item.score || null,
    streamUrl: item.streamUrl || null,
    ...overrides,
    lastUpdated: new Date().toISOString()
  };
}

const fallbackEsports = (league, a, b) => [serializeEsport({ matchId: `demo-${league}-1`, label: `${a} vs ${b}`, status: 'Demo fallback (upstream unavailable)', startTime: futureIso(3), league })];

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  return events.find((e) => normalize(`${e.matchId} ${e.label} ${e.status} ${e.league}`).includes(q)) || null;
}

async function getNbaData() {
  const errors = [];
  const tasks = [
    fetchJson(NBA_URL).then((payload) => ({ source: 'nba', games: (payload?.scoreboard?.games || []).map(serializeNbaFromCdn) })),
    fetchJson(NBA_FALLBACK_URL).then((payload) => ({ source: 'espn', games: (payload?.events || []).map(serializeNbaFromEspn) }))
  ];

  const result = await Promise.any(tasks.map((t) => t.catch((e) => {
    errors.push(e.message);
    throw e;
  }))).catch(() => null);

  if (!result || !result.games.length) {
    const games = fallbackNbaGames();
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: `Live NBA feeds unavailable: ${errors.join(' | ') || 'unreachable'}` };
  }

  const warning = result.source === 'espn' ? 'Using ESPN fallback feed for NBA.' : null;
  return { games: result.games, upcoming: result.games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning };
}

async function resilient(sourceUrl, mapper, fallbackFactory, warningPrefix) {
  try {
    const payload = await fetchJson(sourceUrl);
    const games = mapper(payload);
    if (!games.length) throw new Error('no games in payload');
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: null };
  } catch (err) {
    const games = fallbackFactory();
    return { games, upcoming: games, warning: `${warningPrefix}: ${err.message}` };
  }
}

async function getLolData() {
  const warnings = [];
  const allGames = [];
  const lolApiKey = await getLolApiKey();

  const requests = LOL_REGIONS.map(async (region) => {
    const events = await withDeadline(fetchLolRegionEvents(region, lolApiKey), 4500, `${region.key} region crawl`);
    return events.map((e) => {
      const teams = e.match?.teams || [];
      const leagueName = e.league?.name || `LoL ${region.key}`;
      return serializeEsport({
        matchId: e.id,
        label: `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status: e.state || 'scheduled',
        startTime: e.startTime,
        league: leagueName,
        streamUrl: streamForLolLeague(leagueName, region.key)
      });
    });
  });

  const settled = await Promise.allSettled(requests);
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const region = LOL_REGIONS[i];
    if (result.status === 'fulfilled') {
      allGames.push(...result.value);
    } else {
      warnings.push(`${region.key}: ${result.reason?.message || 'unreachable'}`);
    }
  }

  const deduped = [...new Map(allGames.map((game) => [game.matchId, game])).values()]
    .sort((a, b) => (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER) - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER));

  if (!deduped.length) {
    const games = [
      serializeEsport({ matchId: 'demo-LoL-LCS-1', label: 'Cloud9 vs Team Liquid', status: 'Demo fallback (upstream unavailable)', startTime: futureIso(2), league: 'LoL LCS', streamUrl: LOL_TWITCH_BY_REGION.LCS }),
      serializeEsport({ matchId: 'demo-LoL-LEC-1', label: 'G2 vs Fnatic', status: 'Demo fallback (upstream unavailable)', startTime: futureIso(4), league: 'LoL LEC', streamUrl: LOL_TWITCH_BY_REGION.LEC }),
      serializeEsport({ matchId: 'demo-LoL-LPL-1', label: 'BLG vs TES', status: 'Demo fallback (upstream unavailable)', startTime: futureIso(6), league: 'LoL LPL', streamUrl: LOL_TWITCH_BY_REGION.LPL }),
      serializeEsport({ matchId: 'demo-LoL-LCK-1', label: 'T1 vs Gen.G', status: 'Demo fallback (upstream unavailable)', startTime: futureIso(8), league: 'LoL LCK', streamUrl: LOL_TWITCH_BY_REGION.LCK })
    ];
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: `LoL live feed unavailable: ${warnings.join(' | ') || 'unreachable'}` };
  }

  const warningParts = [];
  if (!lolApiKey) warningParts.push('LoL API key unavailable from lolesports.com (using direct feed; may be rate-limited)');
  if (warnings.length) warningParts.push(`Some LoL regions unavailable: ${warnings.join(' | ')}`);
  const warning = warningParts.length ? warningParts.join(' | ') : null;
  return { games: deduped, upcoming: deduped.filter((g) => inNext12Hours(parseDate(g.startTime))), warning };
}

const getCsData = () => resilient(
  CS_URL,
  (payload) => {
    const items = Array.isArray(payload) ? payload : payload?.matches || payload?.data || [];
    return items.map((item) => mapCsMatch(item));
  },
  () => [
    serializeEsport({ matchId: 'demo-csgo-1', label: 'Team Falcons vs PARIVISION', status: 'Demo fallback (upstream unavailable)', startTime: futureIso(0.25), league: 'Counter-Strike' }),
    serializeEsport({ matchId: 'demo-csgo-2', label: 'Vitality vs FaZe', status: 'Demo fallback (upstream unavailable)', startTime: futureIso(3), league: 'Counter-Strike' })
  ],
  'CS live feed unavailable'
);

const getValorantData = () => resilient(
  VAL_URL,
  (payload) => (payload?.data?.segments || []).map((item) => serializeEsport({ matchId: item.match_page || item.id, label: `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`, status: item.status || 'upcoming', startTime: item.unix_timestamp ? new Date(Number(item.unix_timestamp) * 1000).toISOString() : null, league: item.tournament_name || 'VALORANT', score: item.score || null })),
  () => fallbackEsports('VALORANT', 'Sentinels', 'PRX'),
  'VALORANT live feed unavailable'
);

export const PROVIDERS = {
  nba: { getData: getNbaData, pick: (data, query) => pickNba(data.games, query) },
  lol: { getData: getLolData, pick: (data, query) => pickByQuery(data.games, query) },
  csgo: { getData: getCsData, pick: (data, query) => pickByQuery(data.games, query) },
  valorant: { getData: getValorantData, pick: (data, query) => pickByQuery(data.games, query) }
};

export function resolveProvider(sport) {
  return PROVIDERS[normalize(sport || 'nba')] || null;
}
