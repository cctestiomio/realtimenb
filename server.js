import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const FAST_POLL_MS = 1000;
const HEARTBEAT_MS = 15000;
const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const SCOREBOARD_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const LOL_SCHEDULE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=98767991310872058';
const VAL_SCHEDULE_URL = 'https://vlrggapi.vercel.app/match?q=upcoming';
const CS_SCHEDULE_URL = 'https://hltv-api.vercel.app/api/matches.json';

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

const normalize = (value = '') => value.toLowerCase().trim();
const unique = (arr) => [...new Set(arr)];

function parseDate(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function inNext12Hours(ts) {
  const now = Date.now();
  return ts && ts >= now && ts <= now + UPCOMING_WINDOW_MS;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'realtimenb/1.0'
    }
  });
  if (!response.ok) throw new Error(`Upstream request failed: ${response.status}`);
  return response.json();
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

function formatClock(game) {
  const period = game.period;
  const periodType = period > 4 ? `OT${period - 4}` : `Q${period || 1}`;
  return `${periodType} • ${game.gameClock || game.gameEt || 'TBD'}`;
}

function serializeNbaGame(game) {
  return {
    gameId: game.gameId,
    label: `${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}`,
    status: game.gameStatusText,
    clock: formatClock(game),
    home: { code: game.homeTeam.teamTricode, name: game.homeTeam.teamName, city: game.homeTeam.teamCity, score: Number(game.homeTeam.score) },
    away: { code: game.awayTeam.teamTricode, name: game.awayTeam.teamName, city: game.awayTeam.teamCity, score: Number(game.awayTeam.score) },
    startTime: game.gameEt || null,
    lastUpdated: new Date().toISOString()
  };
}

function pickNbaGame(games, query) {
  const q = normalize(query);
  if (!games?.length) return null;
  if (!q) return games[0];

  const byId = games.find((g) => g.gameId === q || g.gameCode?.toLowerCase() === q);
  if (byId) return byId;

  const teams = parseQueryTeams(q);
  if (teams.length >= 2) {
    const both = games.find((g) => teams.every((t) => [g.homeTeam.teamTricode, g.awayTeam.teamTricode].includes(t)));
    if (both) return both;
  }
  if (teams.length) {
    const one = games.find((g) => [g.homeTeam.teamTricode, g.awayTeam.teamTricode].includes(teams[0]));
    if (one) return one;
  }

  return games.find((g) => normalize(`${g.awayTeam.teamCity} ${g.awayTeam.teamName} ${g.homeTeam.teamCity} ${g.homeTeam.teamName} ${g.gameCode}`).includes(q)) || null;
}

async function getNbaData() {
  const payload = await fetchJson(SCOREBOARD_URL);
  const games = payload?.scoreboard?.games || [];
  const serialized = games.map(serializeNbaGame);

  return {
    games: serialized,
    upcoming: serialized.filter((g) => inNext12Hours(parseDate(g.startTime)))
  };
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events?.length) return null;
  if (!q) return events[0];
  return events.find((event) => normalize(`${event.matchId} ${event.label} ${event.status}`).includes(q)) || null;
}

function serializeEsportEvent(item, overrides = {}) {
  return {
    matchId: String(item.matchId || item.id || item.slug || item.series || item.label),
    label: item.label || `${item.team1 || item.home || 'TBD'} vs ${item.team2 || item.away || 'TBD'}`,
    status: item.status || 'Scheduled',
    startTime: item.startTime || null,
    league: item.league || 'Esports',
    score: item.score || null,
    ...overrides,
    lastUpdated: new Date().toISOString()
  };
}

async function getLolData() {
  const payload = await fetchJson(LOL_SCHEDULE_URL);
  const events = payload?.data?.schedule?.events || [];
  const mapped = events.map((e) => {
    const match = e.match || {};
    const teams = match.teams || [];
    const team1 = teams[0]?.name || 'TBD';
    const team2 = teams[1]?.name || 'TBD';
    return serializeEsportEvent({
      matchId: e.id,
      label: `${team1} vs ${team2}`,
      status: e.state || 'scheduled',
      startTime: e.startTime,
      league: e.league?.name || 'LoL Esports',
      score: match.strategy?.count || null
    });
  });
  return {
    games: mapped,
    upcoming: mapped.filter((m) => inNext12Hours(parseDate(m.startTime)))
  };
}

async function getValorantData() {
  const payload = await fetchJson(VAL_SCHEDULE_URL);
  const items = payload?.data?.segments || [];
  const mapped = items.map((item) => serializeEsportEvent({
    matchId: item.match_page || item.id,
    label: `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`,
    status: item.status || 'upcoming',
    startTime: item.unix_timestamp ? new Date(Number(item.unix_timestamp) * 1000).toISOString() : null,
    league: item.tournament_name || 'VALORANT',
    score: item.score || null
  }));
  return {
    games: mapped,
    upcoming: mapped.filter((m) => inNext12Hours(parseDate(m.startTime)))
  };
}

async function getCsData() {
  const payload = await fetchJson(CS_SCHEDULE_URL);
  const items = Array.isArray(payload) ? payload : payload?.matches || [];
  const mapped = items.map((item) => serializeEsportEvent({
    matchId: item.id,
    label: `${item.team1?.name || item.team1 || 'TBD'} vs ${item.team2?.name || item.team2 || 'TBD'}`,
    status: item.status || 'scheduled',
    startTime: item.date || item.time || null,
    league: item.event?.name || item.tournament || 'Counter-Strike',
    score: item.score || null
  }));
  return {
    games: mapped,
    upcoming: mapped.filter((m) => inNext12Hours(parseDate(m.startTime)))
  };
}

const PROVIDERS = {
  nba: {
    getData: getNbaData,
    pick: (games, query) => {
      const target = pickNbaGame(games.map((g) => ({
        ...g,
        gameId: g.gameId,
        gameCode: g.gameId,
        homeTeam: { teamTricode: g.home.code, teamCity: g.home.city, teamName: g.home.name },
        awayTeam: { teamTricode: g.away.code, teamCity: g.away.city, teamName: g.away.name }
      })), query);
      return target ? games.find((g) => g.gameId === target.gameId) : null;
    }
  },
  lol: { getData: getLolData, pick: pickByQuery },
  csgo: { getData: getCsData, pick: pickByQuery },
  valorant: { getData: getValorantData, pick: pickByQuery }
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relative).replace(/^\.+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function handleStream(req, res, provider, query) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  let active = true;
  let lastPayload = '';

  const send = (event, data) => {
    if (!active) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (active) res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  const poll = async () => {
    try {
      const data = await provider.getData();
      const target = provider.pick(data.games, query);
      if (!target) {
        send('score', { error: `No game found for "${query}"`, query, suggestions: data.games.slice(0, 20).map((g) => g.label) });
        return;
      }
      const next = JSON.stringify(target);
      if (next !== lastPayload) {
        lastPayload = next;
        send('score', target);
      }
    } catch (error) {
      send('score', { error: error.message, query });
    }
  };

  poll();
  const ticker = setInterval(poll, FAST_POLL_MS);

  req.on('close', () => {
    active = false;
    clearInterval(heartbeat);
    clearInterval(ticker);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/games') {
    const sport = String(url.searchParams.get('sport') || 'nba').toLowerCase();
    const provider = PROVIDERS[sport];
    if (!provider) {
      sendJson(res, 400, { error: `Unsupported sport "${sport}"` });
      return;
    }

    try {
      const data = await provider.getData();
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === '/api/stream') {
    const sport = String(url.searchParams.get('sport') || 'nba').toLowerCase();
    const provider = PROVIDERS[sport];
    if (!provider) {
      sendJson(res, 400, { error: `Unsupported sport "${sport}"` });
      return;
    }

    const query = String(url.searchParams.get('query') || '');
    handleStream(req, res, provider, query);
    return;
  }

  await serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Realtime score server listening on http://localhost:${PORT}`);
});
