import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

<<<<<<< codex/build-real-time-nba-score-website-zshsjr
=======
const NBA_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const LOL_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=98767991310872058';
const VAL_URL = 'https://vlrggapi.vercel.app/match?q=upcoming';
const CS_URL = 'https://hltv-api.vercel.app/api/matches.json';

const TEAM_ALIASES = {
  ATL: ['atl', 'hawks', 'atlanta'], BOS: ['bos', 'celtics', 'boston'], BKN: ['bkn', 'nets', 'brooklyn'],
  CHA: ['cha', 'hornets', 'charlotte'], CHI: ['chi', 'bulls', 'chicago'], CLE: ['cle', 'cavaliers', 'cavs', 'cleveland'],
  DAL: ['dal', 'mavericks', 'mavs', 'dallas'], DEN: ['den', 'nuggets', 'denver'], DET: ['det', 'pistons', 'detroit'],
  GSW: ['gsw', 'warriors', 'golden state', 'goldenstate'], HOU: ['hou', 'rockets', 'houston'], IND: ['ind', 'pacers', 'indiana'],
  LAC: ['lac', 'clippers', 'la clippers'], LAL: ['lal', 'lakers', 'la lakers'], MEM: ['mem', 'grizzlies', 'memphis'],
  MIA: ['mia', 'heat', 'miami'], MIL: ['mil', 'bucks', 'milwaukee'], MIN: ['min', 'timberwolves', 'wolves', 'minnesota'],
  NOP: ['nop', 'pelicans', 'new orleans', 'no'], NYK: ['nyk', 'knicks', 'new york'], OKC: ['okc', 'thunder', 'oklahoma city'],
  ORL: ['orl', 'magic', 'orlando'], PHI: ['phi', '76ers', 'sixers', 'philadelphia'], PHX: ['phx', 'suns', 'phoenix'],
  POR: ['por', 'trail blazers', 'blazers', 'portland'], SAC: ['sac', 'kings', 'sacramento'], SAS: ['sas', 'spurs', 'san antonio'],
  TOR: ['tor', 'raptors', 'toronto'], UTA: ['uta', 'jazz', 'utah'], WAS: ['was', 'wizards', 'washington']
};

const normalize = (v = '') => String(v).toLowerCase().trim();
const unique = (arr) => [...new Set(arr)];

function parseDate(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function inNext12Hours(ts) {
  const now = Date.now();
  return ts && ts >= now && ts <= now + UPCOMING_WINDOW_MS;
}

function futureIso(hoursAhead) {
  return new Date(Date.now() + hoursAhead * 3600000).toISOString();
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), ms);
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
    if (!response.ok) throw new Error(`Upstream request failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(`${new URL(url).hostname}: ${error.message}`);
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

function formatClock(period, clock, fallback) {
  const periodType = period > 4 ? `OT${period - 4}` : `Q${period || 1}`;
  return `${periodType} • ${clock || fallback || 'TBD'}`;
}

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
    home: {
      code: home.team?.abbreviation || 'HOME',
      name: home.team?.name || 'Home',
      city: home.team?.location || '',
      score: Number(home.score || 0)
    },
    away: {
      code: away.team?.abbreviation || 'AWAY',
      name: away.team?.name || 'Away',
      city: away.team?.location || '',
      score: Number(away.score || 0)
    },
    startTime: event.date || null,
    lastUpdated: new Date().toISOString()
  };
}

function fallbackNbaGames() {
  return [
    {
      gameId: 'demo-nba-1',
      label: 'BOS @ LAL',
      status: 'Demo fallback (upstream unavailable)',
      clock: 'Q1 • 12:00',
      home: { code: 'LAL', name: 'Lakers', city: 'Los Angeles', score: 0 },
      away: { code: 'BOS', name: 'Celtics', city: 'Boston', score: 0 },
      startTime: futureIso(2),
      lastUpdated: new Date().toISOString()
    }
  ];
}

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

function fallbackEsports(league, a, b) {
  return [
    serializeEsport({
      matchId: `demo-${league}-1`,
      label: `${a} vs ${b}`,
      status: 'Demo fallback (upstream unavailable)',
      startTime: futureIso(3),
      league
    })
  ];
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  return events.find((e) => normalize(`${e.matchId} ${e.label} ${e.status} ${e.league}`).includes(q)) || null;
}

async function getNbaData() {
  const errors = [];

  try {
    const payload = await fetchJson(NBA_URL);
    const games = (payload?.scoreboard?.games || []).map(serializeNbaFromCdn);
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: null };
  } catch (err) {
    errors.push(err.message);
  }

  try {
    const payload = await fetchJson(NBA_FALLBACK_URL);
    const games = (payload?.events || []).map(serializeNbaFromEspn);
    return {
      games,
      upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))),
      warning: errors.join(' | ')
    };
  } catch (err) {
    errors.push(err.message);
  }

  const games = fallbackNbaGames();
  return {
    games,
    upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))),
    warning: `Live NBA feeds unavailable: ${errors.join(' | ')}`
  };
}

async function getLolData() {
  try {
    const payload = await fetchJson(LOL_URL);
    const events = payload?.data?.schedule?.events || [];
    const games = events.map((e) => {
      const teams = e.match?.teams || [];
      return serializeEsport({
        matchId: e.id,
        label: `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status: e.state || 'scheduled',
        startTime: e.startTime,
        league: e.league?.name || 'LoL Esports'
      });
    });
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: null };
  } catch (err) {
    const games = fallbackEsports('LoL Esports', 'T1', 'Gen.G');
    return { games, upcoming: games, warning: `LoL live feed unavailable: ${err.message}` };
  }
}

async function getCsData() {
  try {
    const payload = await fetchJson(CS_URL);
    const items = Array.isArray(payload) ? payload : payload?.matches || [];
    const games = items.map((item) => serializeEsport({
      matchId: item.id,
      label: `${item.team1?.name || item.team1 || 'TBD'} vs ${item.team2?.name || item.team2 || 'TBD'}`,
      status: item.status || 'scheduled',
      startTime: item.date || item.time || null,
      league: item.event?.name || item.tournament || 'Counter-Strike'
    }));
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: null };
  } catch (err) {
    const games = fallbackEsports('Counter-Strike', 'Vitality', 'FaZe');
    return { games, upcoming: games, warning: `CS live feed unavailable: ${err.message}` };
  }
}

async function getValorantData() {
  try {
    const payload = await fetchJson(VAL_URL);
    const items = payload?.data?.segments || [];
    const games = items.map((item) => serializeEsport({
      matchId: item.match_page || item.id,
      label: `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`,
      status: item.status || 'upcoming',
      startTime: item.unix_timestamp ? new Date(Number(item.unix_timestamp) * 1000).toISOString() : null,
      league: item.tournament_name || 'VALORANT',
      score: item.score || null
    }));
    return { games, upcoming: games.filter((g) => inNext12Hours(parseDate(g.startTime))), warning: null };
  } catch (err) {
    const games = fallbackEsports('VALORANT', 'Sentinels', 'PRX');
    return { games, upcoming: games, warning: `VALORANT live feed unavailable: ${err.message}` };
  }
}

const PROVIDERS = {
  nba: { getData: getNbaData, pick: (data, query) => pickNba(data.games, query) },
  lol: { getData: getLolData, pick: (data, query) => pickByQuery(data.games, query) },
  csgo: { getData: getCsData, pick: (data, query) => pickByQuery(data.games, query) },
  valorant: { getData: getValorantData, pick: (data, query) => pickByQuery(data.games, query) }
};

>>>>>>> main
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relative).replace(/^\.+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' });

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

<<<<<<< codex/build-real-time-nba-score-website-zshsjr
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/games' || url.pathname === '/api/track') {
    const sport = String(url.searchParams.get('sport') || 'nba');
    const provider = resolveProvider(sport);
    if (!provider) return sendJson(res, 400, { error: `Unsupported sport "${sport}"` });

    try {
      const data = await provider.getData();

      if (url.pathname === '/api/games') {
        return sendJson(res, 200, { games: data.games, upcoming: data.upcoming, warning: data.warning || null });
      }

      const query = String(url.searchParams.get('query') || '').trim();
      if (!query) return sendJson(res, 400, { error: 'Missing query' });

      const match = provider.pick(data, query);
      if (!match) {
        return sendJson(res, 404, {
          error: `No game found for "${query}"`,
          suggestions: data.games.slice(0, 20).map((g) => g.label),
          warning: data.warning || null
        });
      }

      return sendJson(res, 200, { match, warning: data.warning || null });
    } catch (error) {
      return sendJson(res, 502, { error: error.message || 'Upstream error' });
    }
  }

  if (url.pathname === '/api/stream') {
    return sendJson(res, 410, { error: 'SSE stream is disabled. Use /api/track polling endpoint.' });
=======
function getProvider(url, res) {
  const sport = String(url.searchParams.get('sport') || 'nba').toLowerCase();
  const provider = PROVIDERS[sport];
  if (!provider) {
    sendJson(res, 400, { error: `Unsupported sport "${sport}"` });
    return null;
  }
  return provider;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/games') {
    const provider = getProvider(url, res);
    if (!provider) return;

    const data = await provider.getData();
    sendJson(res, 200, { games: data.games, upcoming: data.upcoming, warning: data.warning || null });
    return;
  }

  if (url.pathname === '/api/track') {
    const provider = getProvider(url, res);
    if (!provider) return;

    const query = String(url.searchParams.get('query') || '').trim();
    if (!query) return sendJson(res, 400, { error: 'Missing query' });

    const data = await provider.getData();
    const match = provider.pick(data, query);

    if (!match) {
      sendJson(res, 404, {
        error: `No game found for "${query}"`,
        suggestions: data.games.slice(0, 20).map((g) => g.label),
        warning: data.warning || null
      });
      return;
    }

    sendJson(res, 200, { match, warning: data.warning || null });
    return;
  }

  if (url.pathname === '/api/stream') {
    sendJson(res, 410, { error: 'SSE stream is disabled. Use /api/track polling endpoint.' });
    return;
>>>>>>> main
  }

  await serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Realtime score server listening on http://localhost:${PORT}`);
});
