<#
.SYNOPSIS
    Applies all fixes to the realtimenb Sports Tracker project.

.DESCRIPTION
    Run this from the ROOT of your cloned realtimenb repository.
    It overwrites lib/providers.js and lib/data-cache.js with fixed versions.

    Fixes applied:
      - LoL 403 errors: hardcoded public API key (no more page-scraping)
      - LoL live scores: uses the getLive endpoint for real scores
      - LoL: completed matches are filtered out of the active games list
      - CS2: stale matches (>4h old, non-live) are pruned; tries two HLTV mirrors
      - VALORANT: merges live_score + upcoming feeds; shows real scores
      - Performance: smarter stale-while-revalidate cache (800ms TTL)

.EXAMPLE
    cd C:\path\to\realtimenb
    .\apply-fixes.ps1
#>

param(
    [string]$RepoRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Ensure-Dir([string]$path) {
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

# ── Verify we're in the repo root ─────────────────────────────────────────────
if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    Write-Error "Could not find package.json in '$RepoRoot'. Run this script from the repo root."
    exit 1
}

$libDir = Join-Path $RepoRoot "lib"
Ensure-Dir $libDir

# ══════════════════════════════════════════════════════════════════════════════
# FILE 1 — lib/providers.js
# ══════════════════════════════════════════════════════════════════════════════
Write-Step "Writing lib/providers.js"

$providersPath = Join-Path $libDir "providers.js"

@'
// ── lib/providers.js ──────────────────────────────────────────────────────────
// Fixed: 2025-02
//  • LoL: hardcoded public API key → no more 403s
//  • LoL: getLive endpoint for real-time scores
//  • LoL: completed events filtered out of active list
//  • CS2: date-filter stale matches; multi-source fallback
//  • VALORANT: merges live_score + upcoming feeds
//  • Performance: shorter fetch timeout, parallel fetches

const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const STALE_CUTOFF_MS    = 4 * 60 * 60 * 1000;   // hide matches >4 h old unless live
const FETCH_TIMEOUT_MS   = 3000;

// ── NBA ───────────────────────────────────────────────────────────────────────
const NBA_URL          = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// ── League of Legends ─────────────────────────────────────────────────────────
// The public community API key for the unofficial LoL esports API.
// This is the same key embedded in every official Riot esports app and
// is safe to use client-side — not a private secret.
const LOL_PUBLIC_API_KEY = process.env.LOL_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_SCHEDULE_URL   = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const LOL_LIVE_URL       = 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US';
const LOL_PAGE_LIMIT     = 2;

const LOL_REGIONS = [
  { key: 'LCS', name: 'North America', leagueId: '98767991299243165' },
  { key: 'LEC', name: 'Europe',        leagueId: '98767991302996019' },
  { key: 'LPL', name: 'China',         leagueId: '98767991314006698' },
  { key: 'LCK', name: 'Korea',         leagueId: '98767991310872058' }
];

const LOL_TWITCH_BY_REGION = {
  LCS:     'https://www.twitch.tv/lcs',
  LEC:     'https://www.twitch.tv/lec',
  LPL:     'https://www.twitch.tv/lpl',
  LCK:     'https://www.twitch.tv/lck',
  DEFAULT: 'https://www.twitch.tv/riotgames'
};

// ── CS2 ───────────────────────────────────────────────────────────────────────
// Primary + fallback HLTV mirror APIs
const CS_SOURCES = [
  'https://hltv-api-steel.vercel.app/api/matches',
  'https://hltv-api.vercel.app/api/matches.json',
];

// ── VALORANT ──────────────────────────────────────────────────────────────────
const VAL_LIVE_URL     = 'https://vlrggapi.vercel.app/match?q=live_score';
const VAL_UPCOMING_URL = 'https://vlrggapi.vercel.app/match?q=upcoming';

// ── Team alias map (NBA) ──────────────────────────────────────────────────────
const TEAM_ALIASES = {
  ATL: ['atl','hawks','atlanta'],           BOS: ['bos','celtics','boston'],
  BKN: ['bkn','nets','brooklyn'],           CHA: ['cha','hornets','charlotte'],
  CHI: ['chi','bulls','chicago'],           CLE: ['cle','cavaliers','cavs','cleveland'],
  DAL: ['dal','mavericks','mavs','dallas'], DEN: ['den','nuggets','denver'],
  DET: ['det','pistons','detroit'],         GSW: ['gsw','warriors','golden state','goldenstate'],
  HOU: ['hou','rockets','houston'],         IND: ['ind','pacers','indiana'],
  LAC: ['lac','clippers','la clippers'],    LAL: ['lal','lakers','la lakers'],
  MEM: ['mem','grizzlies','memphis'],       MIA: ['mia','heat','miami'],
  MIL: ['mil','bucks','milwaukee'],         MIN: ['min','timberwolves','wolves','minnesota'],
  NOP: ['nop','pelicans','new orleans','no'], NYK: ['nyk','knicks','new york'],
  OKC: ['okc','thunder','oklahoma city'],   ORL: ['orl','magic','orlando'],
  PHI: ['phi','76ers','sixers','philadelphia'], PHX: ['phx','suns','phoenix'],
  POR: ['por','trail blazers','blazers','portland'], SAC: ['sac','kings','sacramento'],
  SAS: ['sas','spurs','san antonio'],       TOR: ['tor','raptors','toronto'],
  UTA: ['uta','jazz','utah'],               WAS: ['was','wizards','washington']
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalize   = (v = '') => String(v).toLowerCase().trim();
const unique      = (arr) => [...new Set(arr)];
const parseDate   = (value) => { const t = new Date(value).getTime(); return Number.isFinite(t) ? t : null; };
const inNext12h   = (ts) => ts && ts >= Date.now() && ts <= Date.now() + UPCOMING_WINDOW_MS;
const isLiveStr   = (s = '') => /live|inprogress|in.?progress/i.test(s);
const isCompleted = (s = '') => /completed?|finished?|over|final/i.test(s);
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
      cache: 'no-store',
      signal: controller.signal,
      ...options,
      headers: {
        'User-Agent': 'realtimenb/2.0',
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } finally {
    cleanup();
  }
}

function lolHeaders() {
  return {
    Accept:      'application/json',
    Origin:      'https://lolesports.com',
    Referer:     'https://lolesports.com/',
    'x-api-key': LOL_PUBLIC_API_KEY
  };
}

async function withDeadline(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ── NBA serialisers ───────────────────────────────────────────────────────────
const formatClock = (period, clock, fallback) =>
  `${period > 4 ? `OT${period - 4}` : `Q${period || 1}`} • ${clock || fallback || 'TBD'}`;

function serializeNbaFromCdn(game) {
  return {
    gameId:    game.gameId,
    label:     `${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}`,
    status:    game.gameStatusText,
    clock:     formatClock(game.period, game.gameClock, game.gameEt),
    home:      { code: game.homeTeam.teamTricode, name: game.homeTeam.teamName, city: game.homeTeam.teamCity, score: Number(game.homeTeam.score) },
    away:      { code: game.awayTeam.teamTricode, name: game.awayTeam.teamName, city: game.awayTeam.teamCity, score: Number(game.awayTeam.score) },
    startTime: game.gameEt || null,
    lastUpdated: new Date().toISOString()
  };
}

function serializeNbaFromEspn(event) {
  const comp  = event.competitions?.[0] || {};
  const teams = comp.competitors || [];
  const away  = teams.find((t) => t.homeAway === 'away') || teams[0] || {};
  const home  = teams.find((t) => t.homeAway === 'home') || teams[1] || {};
  return {
    gameId:    event.id,
    label:     `${away.team?.abbreviation || 'AWAY'} @ ${home.team?.abbreviation || 'HOME'}`,
    status:    comp.status?.type?.description || 'Scheduled',
    clock:     formatClock(comp.status?.period || 1, comp.status?.displayClock, event.date),
    home:      { code: home.team?.abbreviation || 'HOME', name: home.team?.name || 'Home', city: home.team?.location || '', score: Number(home.score || 0) },
    away:      { code: away.team?.abbreviation || 'AWAY', name: away.team?.name || 'Away', city: away.team?.location || '', score: Number(away.score || 0) },
    startTime: event.date || null,
    lastUpdated: new Date().toISOString()
  };
}

const fallbackNbaGames = () => [
  { gameId: 'demo-nba-1', label: 'BOS @ LAL', status: 'Demo fallback', clock: 'Q1 • 12:00', home: { code: 'LAL', name: 'Lakers',  city: 'Los Angeles',  score: 0 }, away: { code: 'BOS', name: 'Celtics',  city: 'Boston',       score: 0 }, startTime: futureIso(2), lastUpdated: new Date().toISOString() },
  { gameId: 'demo-nba-2', label: 'GSW @ DEN', status: 'Demo fallback', clock: 'Q1 • 12:00', home: { code: 'DEN', name: 'Nuggets',  city: 'Denver',       score: 0 }, away: { code: 'GSW', name: 'Warriors', city: 'Golden State', score: 0 }, startTime: futureIso(4), lastUpdated: new Date().toISOString() }
];

function parseQueryTeams(query) {
  const q = normalize(query);
  if (!q) return [];
  const matched = [];
  for (const [code, aliases] of Object.entries(TEAM_ALIASES)) {
    if (unique([code.toLowerCase(), ...aliases]).some((term) => q.includes(term))) matched.push(code);
  }
  return unique(matched);
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

// ── Esport helpers ────────────────────────────────────────────────────────────
function serializeEsport(item, overrides = {}) {
  return {
    matchId:     String(item.matchId || item.id || item.slug || item.label || 'unknown'),
    label:       item.label || 'TBD vs TBD',
    status:      item.status || 'Scheduled',
    startTime:   item.startTime || null,
    league:      item.league || 'Esports',
    score:       item.score || null,
    streamUrl:   item.streamUrl || null,
    ...overrides,
    lastUpdated: new Date().toISOString()
  };
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  return events.find((e) => normalize(`${e.matchId} ${e.label} ${e.status} ${e.league}`).includes(q)) || null;
}

function detectLolRegionKey(value = '') {
  const l = normalize(value);
  if (l.includes('lcs') || l.includes('north america') || l.includes('na')) return 'LCS';
  if (l.includes('lec') || l.includes('europe') || l.includes('eu'))        return 'LEC';
  if (l.includes('lpl') || l.includes('china') || l.includes('cn'))         return 'LPL';
  if (l.includes('lck') || l.includes('korea') || l.includes('kr'))         return 'LCK';
  return null;
}

function streamForLolLeague(leagueName, fallbackRegion = null) {
  const key = detectLolRegionKey(leagueName) || fallbackRegion;
  return LOL_TWITCH_BY_REGION[key] || LOL_TWITCH_BY_REGION.DEFAULT;
}

// ── LoL live-score overlay ────────────────────────────────────────────────────
async function fetchLolLiveScores() {
  try {
    const payload = await withDeadline(
      fetchJson(LOL_LIVE_URL, { headers: lolHeaders() }),
      3000, 'getLive'
    );
    const events = payload?.data?.schedule?.events || [];
    const scoreMap = new Map();
    for (const ev of events) {
      if (!ev?.id) continue;
      const teams  = ev.match?.teams || [];
      const scores = teams.map((t) => t.result?.gameWins ?? 0).join('-');
      scoreMap.set(ev.id, scores);
    }
    return scoreMap;
  } catch {
    return new Map();
  }
}

// ── LoL region schedule ───────────────────────────────────────────────────────
async function fetchLolRegionEvents(region) {
  const events     = [];
  const seenEvents = new Set();
  const seenTokens = new Set(['']);
  const tokenQueue = [''];

  while (tokenQueue.length && seenTokens.size <= LOL_PAGE_LIMIT) {
    const pageToken = tokenQueue.shift();
    const url = `${LOL_SCHEDULE_URL}&leagueId=${encodeURIComponent(region.leagueId)}`
              + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

    const payload = await withDeadline(
      fetchJson(url, { headers: lolHeaders() }),
      4000, `${region.key} schedule`
    );

    const schedule = payload?.data?.schedule || {};
    for (const event of schedule.events || []) {
      if (!event?.id || seenEvents.has(event.id)) continue;
      seenEvents.add(event.id);
      events.push(event);
    }

    for (const token of [schedule?.pages?.older, schedule?.pages?.newer]) {
      if (!token || seenTokens.has(token) || seenTokens.size > LOL_PAGE_LIMIT) continue;
      seenTokens.add(token);
      tokenQueue.push(token);
    }
  }

  return events;
}

// ── NBA provider ──────────────────────────────────────────────────────────────
async function getNbaData() {
  const errors = [];
  const tasks = [
    fetchJson(NBA_URL).then((p) => ({ source: 'nba',  games: (p?.scoreboard?.games || []).map(serializeNbaFromCdn) })),
    fetchJson(NBA_FALLBACK_URL).then((p) => ({ source: 'espn', games: (p?.events || []).map(serializeNbaFromEspn) }))
  ];

  const result = await Promise.any(
    tasks.map((t) => t.catch((e) => { errors.push(e.message); throw e; }))
  ).catch(() => null);

  if (!result?.games?.length) {
    const games = fallbackNbaGames();
    return { games, upcoming: games.filter((g) => inNext12h(parseDate(g.startTime))), warning: `Live NBA feeds unavailable: ${errors.join(' | ')}` };
  }

  return {
    games:    result.games,
    upcoming: result.games.filter((g) => inNext12h(parseDate(g.startTime))),
    warning:  result.source === 'espn' ? 'Using ESPN fallback for NBA.' : null
  };
}

// ── LoL provider ──────────────────────────────────────────────────────────────
async function getLolData() {
  const warnings = [];
  const allGames = [];

  const [settled, liveScores] = await Promise.all([
    Promise.allSettled(LOL_REGIONS.map((r) =>
      withDeadline(fetchLolRegionEvents(r), 5000, `${r.key} crawl`)
        .then((events) => ({ region: r, events }))
    )),
    fetchLolLiveScores()
  ]);

  for (const result of settled) {
    if (result.status === 'rejected') {
      const idx    = settled.indexOf(result);
      const region = LOL_REGIONS[idx];
      warnings.push(`${region.key}: ${result.reason?.message || 'unreachable'}`);
      continue;
    }

    const { region, events } = result.value;
    for (const e of events) {
      const state = e.state || '';

      // Skip completed matches entirely
      if (isCompleted(state)) continue;

      const teams      = e.match?.teams || [];
      const leagueName = e.league?.name || `LoL ${region.key}`;
      const liveScore  = liveScores.get(e.id) || null;

      allGames.push(serializeEsport({
        matchId:   e.id,
        label:     `${teams[0]?.name || 'TBD'} vs ${teams[1]?.name || 'TBD'}`,
        status:    isLiveStr(state) ? 'Live' : state || 'Scheduled',
        startTime: e.startTime,
        league:    leagueName,
        score:     liveScore,
        streamUrl: streamForLolLeague(leagueName, region.key)
      }));
    }
  }

  const deduped = [...new Map(allGames.map((g) => [g.matchId, g])).values()]
    .sort((a, b) => {
      const aLive = isLiveStr(a.status) ? 0 : 1;
      const bLive = isLiveStr(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER)
           - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER);
    });

  if (!deduped.length) {
    const fallbackGames = [
      serializeEsport({ matchId: 'demo-lol-lck-1', label: 'DNS vs DK',          status: 'Demo (upstream unavailable)', startTime: futureIso(1), league: 'LoL LCK', streamUrl: LOL_TWITCH_BY_REGION.LCK }),
      serializeEsport({ matchId: 'demo-lol-lec-1', label: 'NAVI vs G2',         status: 'Demo (upstream unavailable)', startTime: futureIso(2), league: 'LoL LEC', streamUrl: LOL_TWITCH_BY_REGION.LEC }),
      serializeEsport({ matchId: 'demo-lol-lcs-1', label: 'Team Liquid vs DSG', status: 'Demo (upstream unavailable)', startTime: futureIso(5), league: 'LoL LCS', streamUrl: LOL_TWITCH_BY_REGION.LCS }),
      serializeEsport({ matchId: 'demo-lol-lpl-1', label: 'BLG vs TES',         status: 'Demo (upstream unavailable)', startTime: futureIso(7), league: 'LoL LPL', streamUrl: LOL_TWITCH_BY_REGION.LPL })
    ];
    return {
      games:    fallbackGames,
      upcoming: fallbackGames.filter((g) => inNext12h(parseDate(g.startTime))),
      warning:  `LoL live feed unavailable: ${warnings.join(' | ') || 'all regions failed'}`
    };
  }

  return {
    games:    deduped,
    upcoming: deduped.filter((g) => inNext12h(parseDate(g.startTime))),
    warning:  warnings.length ? `Some LoL regions unavailable: ${warnings.join(' | ')}` : null
  };
}

// ── CS2 provider ──────────────────────────────────────────────────────────────
function extractTeamName(team) {
  if (!team) return null;
  if (typeof team === 'string') return team.trim() || null;
  return team.name || team.teamName || team.team || team.slug || null;
}

function parseEventStartTime(item) {
  const direct = item.startTime || item.date || item.datetime || item.time || item.matchTime || null;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return new Date(direct > 1e12 ? direct : direct * 1000).toISOString();
  }
  if (typeof direct === 'string' && direct.trim()) {
    const parsed = Date.parse(direct.trim());
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  for (const key of ['date_unix', 'dateUnix', 'unix', 'timestamp', 'startAt']) {
    const num = Number(item[key]);
    if (Number.isFinite(num) && num > 0) {
      return new Date(num > 1e12 ? num : num * 1000).toISOString();
    }
  }
  return null;
}

function mapCsMatch(item = {}) {
  const teams = Array.isArray(item.teams) ? item.teams : [];
  const team1 = extractTeamName(item.team1) || extractTeamName(teams[0]) || 'TBD';
  const team2 = extractTeamName(item.team2) || extractTeamName(teams[1]) || 'TBD';

  return serializeEsport({
    matchId:   String(item.id || item.matchId || item.slug || `${team1}-${team2}-${item.date || ''}`),
    label:     `${team1} vs ${team2}`,
    status:    item.status || item.state || (item.live ? 'live' : 'Scheduled'),
    startTime: parseEventStartTime(item),
    league:    item.event?.name || item.eventName || item.tournament || item.title || 'Counter-Strike'
  });
}

function isStaleMatch(game) {
  // Remove matches that are >STALE_CUTOFF_MS in the past and are not live
  if (isLiveStr(game.status)) return false;
  const ts = parseDate(game.startTime);
  if (!ts) return false;
  return ts < Date.now() - STALE_CUTOFF_MS;
}

async function getCsGamesFromSource(url) {
  const payload = await fetchJson(url);
  const items   = Array.isArray(payload) ? payload : payload?.matches || payload?.data || [];
  if (!items.length) throw new Error('empty payload');
  const games = items.map(mapCsMatch).filter((g) => !isStaleMatch(g));
  if (!games.length) throw new Error('all matches are stale (old dates)');
  return games;
}

async function getCsData() {
  const errors = [];
  for (const url of CS_SOURCES) {
    try {
      const games = await getCsGamesFromSource(url);
      return {
        games,
        upcoming: games.filter((g) => inNext12h(parseDate(g.startTime))),
        warning:  null
      };
    } catch (err) {
      errors.push(`${url.replace('https://', '')}: ${err.message}`);
    }
  }

  const fallback = [
    serializeEsport({ matchId: 'demo-cs-1', label: 'Team Falcons vs PARIVISION', status: 'Demo (upstream unavailable)', startTime: futureIso(0.5), league: 'Counter-Strike' }),
    serializeEsport({ matchId: 'demo-cs-2', label: 'Vitality vs FaZe',           status: 'Demo (upstream unavailable)', startTime: futureIso(4),   league: 'Counter-Strike' })
  ];
  return {
    games:    fallback,
    upcoming: fallback,
    warning:  `CS2 live feed unavailable: ${errors.join(' | ')}`
  };
}

// ── VALORANT provider ─────────────────────────────────────────────────────────
function mapVlrMatch(item, forceStatus) {
  const score = [item.score1, item.score2].filter((s) => s != null).join('-') || item.score || null;
  return serializeEsport({
    matchId:   item.match_page || item.id || `${item.team1}-${item.team2}`,
    label:     `${item.team1 || 'TBD'} vs ${item.team2 || 'TBD'}`,
    status:    forceStatus || item.status || item.time_until_match || 'Scheduled',
    startTime: item.unix_timestamp
      ? new Date(Number(item.unix_timestamp) * 1000).toISOString()
      : null,
    league:    item.tournament_name || item.match_event || 'VALORANT',
    score
  });
}

async function getValorantData() {
  const errors   = [];
  const allGames = [];
  const seenIds  = new Set();

  const add = (game) => {
    if (seenIds.has(game.matchId)) return;
    seenIds.add(game.matchId);
    allGames.push(game);
  };

  const [liveRes, upcomingRes] = await Promise.allSettled([
    fetchJson(VAL_LIVE_URL),
    fetchJson(VAL_UPCOMING_URL)
  ]);

  if (liveRes.status === 'fulfilled') {
    for (const seg of liveRes.value?.data?.segments || []) {
      add(mapVlrMatch(seg, 'Live'));
    }
  } else {
    errors.push(`live_score: ${liveRes.reason?.message || 'failed'}`);
  }

  if (upcomingRes.status === 'fulfilled') {
    for (const seg of upcomingRes.value?.data?.segments || []) {
      add(mapVlrMatch(seg, null));
    }
  } else {
    errors.push(`upcoming: ${upcomingRes.reason?.message || 'failed'}`);
  }

  allGames.sort((a, b) => {
    const aLive = isLiveStr(a.status) ? 0 : 1;
    const bLive = isLiveStr(b.status) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return (parseDate(a.startTime) || Number.MAX_SAFE_INTEGER)
         - (parseDate(b.startTime) || Number.MAX_SAFE_INTEGER);
  });

  if (!allGames.length) {
    const fallback = [
      serializeEsport({ matchId: 'demo-val-1', label: 'Sentinels vs PRX',   status: 'Demo (upstream unavailable)', startTime: futureIso(1), league: 'VALORANT Champions Tour' }),
      serializeEsport({ matchId: 'demo-val-2', label: 'Team Liquid vs NRG', status: 'Demo (upstream unavailable)', startTime: futureIso(3), league: 'VALORANT Champions Tour' })
    ];
    return {
      games:    fallback,
      upcoming: fallback,
      warning:  `VALORANT live feed unavailable: ${errors.join(' | ')}`
    };
  }

  return {
    games:    allGames,
    upcoming: allGames.filter((g) => inNext12h(parseDate(g.startTime))),
    warning:  errors.length ? `Some VALORANT feeds failed: ${errors.join(' | ')}` : null
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────
export const PROVIDERS = {
  nba:      { getData: getNbaData,      pick: (data, q) => pickNba(data.games, q) },
  lol:      { getData: getLolData,      pick: (data, q) => pickByQuery(data.games, q) },
  csgo:     { getData: getCsData,       pick: (data, q) => pickByQuery(data.games, q) },
  valorant: { getData: getValorantData, pick: (data, q) => pickByQuery(data.games, q) }
};

export function resolveProvider(sport) {
  return PROVIDERS[normalize(sport || 'nba')] || null;
}
'@ | Set-Content -Path $providersPath -Encoding UTF8

Write-Host "    OK: $providersPath" -ForegroundColor Green

# ══════════════════════════════════════════════════════════════════════════════
# FILE 2 — lib/data-cache.js
# ══════════════════════════════════════════════════════════════════════════════
Write-Step "Writing lib/data-cache.js"

$cachePath = Join-Path $libDir "data-cache.js"

@'
// lib/data-cache.js — optimised for real-time feel on serverless
// • 800 ms TTL (fast enough to feel live, low enough to not hammer upstreams)
// • Stale-while-revalidate: returns cached value immediately while refreshing
// • Per-sport in-flight deduplication

const DEFAULT_TTL_MS = 800;

const cache = new Map();

export async function getCachedProviderData(sportKey, loader, ttlMs = DEFAULT_TTL_MS) {
  const now     = Date.now();
  const current = cache.get(sportKey);
  const age     = current ? now - current.fetchedAt : Infinity;
  const fresh   = age <= ttlMs;

  // Fresh hit — serve immediately
  if (current?.value && fresh) return current.value;

  // In-flight deduplication
  if (current?.inFlight) {
    // Return stale value instantly if available; in-flight will update the cache
    return current.value ?? current.inFlight;
  }

  // Kick off a new fetch
  const inFlight = loader()
    .then((value) => {
      cache.set(sportKey, { value, fetchedAt: Date.now(), inFlight: null });
      return value;
    })
    .catch((error) => {
      cache.set(sportKey, {
        value:     current?.value ?? null,
        fetchedAt: current?.fetchedAt ?? 0,
        inFlight:  null
      });
      throw error;
    });

  cache.set(sportKey, {
    value:     current?.value ?? null,
    fetchedAt: current?.fetchedAt ?? 0,
    inFlight
  });

  // Stale-while-revalidate: return old data immediately; in-flight will update
  if (current?.value) return current.value;

  // No prior cache at all — must await first load
  return inFlight;
}
'@ | Set-Content -Path $cachePath -Encoding UTF8

Write-Host "    OK: $cachePath" -ForegroundColor Green

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " All fixes applied successfully!" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host " Changes made:"
Write-Host "   lib/providers.js  — LoL key fix, CS2 date filter, VALORANT live feed"
Write-Host "   lib/data-cache.js — stale-while-revalidate, 800ms TTL"
Write-Host ""
Write-Host " Next steps:"
Write-Host "   1. git add lib/providers.js lib/data-cache.js"
Write-Host "   2. git commit -m 'fix: LoL 403, CS2 stale matches, VALORANT live scores'"
Write-Host "   3. git push  (Vercel will auto-deploy)"
Write-Host ""
Write-Host " Optional: set LOL_API_KEY env var in Vercel to override the hardcoded key."
Write-Host " The hardcoded key (0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z) is the"
Write-Host " same public key used by every community LoL esports tool."
Write-Host ""