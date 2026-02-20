const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2200;

const NBA_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const LOL_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=98767991310872058';
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

async function fetchJson(url) {
  const { controller, timeout } = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'realtimenb/1.0' }
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
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

function serializeEsport(item, overrides = {}) {
  return {
    matchId: String(item.matchId || item.id || item.slug || item.series || item.label),
    label: item.label || `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`,
    status: item.status || 'Scheduled',
    startTime: item.startTime || null,
    league: item.league || 'Esports',
    score: item.score || null,
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

const getLolData = () => resilient(
  LOL_URL,
  (payload) => (payload?.data?.schedule?.events || []).map((e) => {
    const teams = e.match?.teams || [];
    return serializeEsport({ matchId: e.id, label: `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`, status: e.state || 'scheduled', startTime: e.startTime, league: e.league?.name || 'LoL Esports' });
  }),
  () => fallbackEsports('LoL Esports', 'T1', 'Gen.G'),
  'LoL live feed unavailable'
);

const getCsData = () => resilient(
  CS_URL,
  (payload) => {
    const items = Array.isArray(payload) ? payload : payload?.matches || [];
    return items.map((item) => serializeEsport({ matchId: item.id, label: `${item.team1?.name || item.team1 || 'TBD'} vs ${item.team2?.name || item.team2 || 'TBD'}`, status: item.status || 'scheduled', startTime: item.date || item.time || null, league: item.event?.name || item.tournament || 'Counter-Strike' }));
  },
  () => fallbackEsports('Counter-Strike', 'Vitality', 'FaZe'),
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
