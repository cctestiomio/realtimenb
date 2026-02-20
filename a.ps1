#Requires -Version 5.1
<#
.SYNOPSIS
    Applies ALL fixes to the realtimenb Sports Tracker project.
.DESCRIPTION
    Run from the ROOT of your cloned realtimenb repo:
        cd C:\path\to\realtimenb
        .\apply-fixes.ps1

    Fixes applied:
      ENCODING   - Write-FileUtf8NoBOM() so bullets never garble in browser
      LOL        - Hardcoded public API key (no more 403s), no pagination (no timeouts),
                   completed games filtered out, live scores via getLive endpoint
      CS2        - Freshness guard discards stale/Oct-2023 data, 3 mirror sources
      VALORANT   - Fixes unix_timestamp parsing (date-string vs int), merges live+upcoming
      UI         - New green "Live now" section separate from Upcoming
      vercel.json - maxDuration 15s so LoL region fetches don't die
#>
param([string]$RepoRoot = $PSScriptRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helper: write UTF-8 WITHOUT BOM so browsers never garble special characters
# ---------------------------------------------------------------------------
function Write-FileUtf8NoBOM {
    param([string]$Path, [string]$Content)
    $enc = [System.Text.UTF8Encoding]::new($false)   # $false = no BOM
    $dir = Split-Path $Path -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
    Write-Host "    OK  $Path" -ForegroundColor Green
}

# Sanity check
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
    Write-Error "Cannot find package.json in '$RepoRoot'. Run from the repo root."
    exit 1
}
Write-Host "`n[realtimenb patcher]  Root: $RepoRoot`n" -ForegroundColor Cyan

# ===========================================================================
# 1. vercel.json
# ===========================================================================
Write-Host '>>> vercel.json  (bump function timeout to 15s)' -ForegroundColor Yellow
Write-FileUtf8NoBOM (Join-Path $RepoRoot 'vercel.json') @'
{
  "functions": {
    "api/*.js": {
      "maxDuration": 15
    }
  }
}
'@

# ===========================================================================
# 2. lib/data-cache.js
# ===========================================================================
Write-Host '>>> lib/data-cache.js  (stale-while-revalidate, 800ms TTL)' -ForegroundColor Yellow
Write-FileUtf8NoBOM (Join-Path $RepoRoot 'lib\data-cache.js') @'
// lib/data-cache.js
// Stale-while-revalidate: returns cached value instantly while refreshing in bg.
const DEFAULT_TTL_MS = 800;
const cache = new Map();

export async function getCachedProviderData(sportKey, loader, ttlMs = DEFAULT_TTL_MS) {
  const now     = Date.now();
  const current = cache.get(sportKey);
  const age     = current ? now - current.fetchedAt : Infinity;

  if (current?.value && age <= ttlMs) return current.value;
  if (current?.inFlight) return current.value ?? current.inFlight;

  const inFlight = loader()
    .then((value) => {
      cache.set(sportKey, { value, fetchedAt: Date.now(), inFlight: null });
      return value;
    })
    .catch((err) => {
      cache.set(sportKey, { value: current?.value ?? null, fetchedAt: current?.fetchedAt ?? 0, inFlight: null });
      throw err;
    });

  cache.set(sportKey, { value: current?.value ?? null, fetchedAt: current?.fetchedAt ?? 0, inFlight });
  if (current?.value) return current.value;
  return inFlight;
}
'@

# ===========================================================================
# 3. lib/providers.js
# All special chars use \uXXXX escapes so file encoding is irrelevant.
# ===========================================================================
Write-Host '>>> lib/providers.js  (LoL key, CS2 freshness, VALORANT timestamps)' -ForegroundColor Yellow
Write-FileUtf8NoBOM (Join-Path $RepoRoot 'lib\providers.js') @'
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

// Fetch a single page per region — no pagination avoids Vercel cold-start timeouts
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
'@

# ===========================================================================
# 4. public/index.html  — adds data-live section and data-live-header
# ===========================================================================
Write-Host '>>> public/index.html  (add live-now section)' -ForegroundColor Yellow
Write-FileUtf8NoBOM (Join-Path $RepoRoot 'public\index.html') @'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Realtime Sports Tracker</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="app">
      <div class="top-row">
        <div>
          <h1>Realtime Sports Tracker</h1>
          <p class="tagline">Live + upcoming (next 12h): NBA, LoL Esports, CS2/CSGO, VALORANT</p>
        </div>
        <button id="theme-toggle" class="theme-toggle" type="button">&#127769; Dark mode</button>
      </div>

      <div id="sections" class="sections"></div>
    </main>

    <template id="sport-template">
      <section class="sport-card" data-sport-card>
        <h2 data-title></h2>
        <form class="search-row" data-form>
          <input data-input placeholder="Type game or click a listed match" required />
          <button type="submit">Track</button>
        </form>

        <!-- LIVE NOW section (hidden until there are live games) -->
        <div class="section-label section-label--live" data-live-header hidden>&#128994; Live Now</div>
        <div class="games-list" data-live></div>

        <!-- UPCOMING section -->
        <p class="help" data-help>Loading&#8230;</p>
        <div class="games-list" data-upcoming></div>

        <!-- ALL OTHER (scheduled) -->
        <div class="games-list" data-all></div>

        <div class="stream-row" data-stream-row hidden>
          <button class="stream-btn" type="button" data-stream-btn>Open official LoL Twitch stream</button>
        </div>

        <section class="score-card" data-score hidden>
          <div class="team" data-away></div>
          <div class="center">
            <div class="status" data-status>Waiting&#8230;</div>
            <div class="clock" data-clock></div>
          </div>
          <div class="team" data-home></div>
        </section>

        <p class="error" data-error role="alert"></p>
      </section>
    </template>

    <script type="module" src="/app.js"></script>
  </body>
</html>
'@

# ===========================================================================
# 5. public/styles.css  — live chips (green), live section label
# ===========================================================================
Write-Host '>>> public/styles.css  (live chip styles)' -ForegroundColor Yellow
Write-FileUtf8NoBOM (Join-Path $RepoRoot 'public\styles.css') @'
:root {
  color-scheme: light;
  --bg: #eff4fb;
  --bg-accent: #d9e7ff;
  --surface: #ffffff;
  --surface-2: #f8fbff;
  --line: #d2def4;
  --text: #0f1a2f;
  --muted: #54627f;
  --accent: #2f6fff;
  --error: #b42318;
  --live: #16a34a;
  --live-bg: #dcfce7;
  --live-line: #86efac;
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #070b14;
  --bg-accent: #10203f;
  --surface: #121b2d;
  --surface-2: #0f1625;
  --line: #2d3a55;
  --text: #ecf2ff;
  --muted: #9fb0d3;
  --accent: #37a2ff;
  --error: #ff8d8d;
  --live: #4ade80;
  --live-bg: #052e16;
  --live-line: #166534;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: radial-gradient(circle at top, var(--bg-accent), var(--bg) 60%);
  color: var(--text);
}

.app { width: min(1100px, 94vw); margin: 0 auto; padding: 1rem 0 2rem; }

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

h1 { margin: 0 0 0.2rem; }
.tagline, .help, .hint { color: var(--muted); }

.theme-toggle, .search-row button {
  background: linear-gradient(135deg, #2976ff, var(--accent));
  border: none;
  color: white;
  border-radius: 10px;
  padding: 0.7rem 0.9rem;
  cursor: pointer;
  font-weight: 600;
}

.sections {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.sport-card {
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--surface), var(--surface-2));
  padding: 1rem;
}
.sport-card h2 { margin-top: 0; }

.search-row { display: flex; gap: 0.5rem; }

input {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 1rem;
  padding: 0.7rem 0.9rem;
}

/* Section labels */
.section-label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0.6rem 0 0.25rem;
  color: var(--muted);
}
.section-label--live { color: var(--live); }

/* Chip list */
.games-list { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.4rem; }

.game-chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  padding: 0.42rem 0.75rem;
  font-size: 0.82rem;
  cursor: pointer;
  transition: border-color 0.15s;
}
.game-chip:hover, .game-chip.active { border-color: var(--accent); }

/* Live chips — green tinted */
.game-chip.chip-live {
  border-color: var(--live-line);
  background: var(--live-bg);
  color: var(--live);
  font-weight: 600;
}
.game-chip.chip-live:hover, .game-chip.chip-live.active { border-color: var(--live); }

/* Score card */
.score-card {
  margin-top: 0.6rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem;
}
.team { display: grid; gap: 0.2rem; }
.team:last-child { text-align: right; }
.abbr { color: var(--muted); font-size: 0.92rem; }
.score { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; line-height: 1; }
.status, .clock { text-align: center; }
.status { font-weight: 700; }
.error { color: var(--error); min-height: 1.2rem; }

/* Stream button */
.stream-row { margin: 0.35rem 0 0.5rem; }
.stream-btn {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  padding: 0.6rem 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.stream-btn:hover { border-color: var(--accent); }

@media (max-width: 950px) { .sections { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .top-row, .search-row { flex-direction: column; }
  .score-card { grid-template-columns: 1fr; text-align: center; }
  .team:last-child { text-align: center; }
}
'@

# ===========================================================================
# 6. public/app.js  — live section, encoding-safe bullets, robust time parse
# ===========================================================================
Write-Host '>>> public/app.js  (live section + encoding fixes)' -ForegroundColor Yellow
Write-FileUtf8NoBOM (Join-Path $RepoRoot 'public\app.js') @'
// public/app.js
// All special characters use \uXXXX escapes for encoding safety.

const sports = [
  { key: 'nba',      label: 'NBA' },
  { key: 'lol',      label: 'League of Legends Esports' },
  { key: 'csgo',     label: 'CS2 / CSGO Esports' },
  { key: 'valorant', label: 'VALORANT Esports' }
];

const TRACK_POLL_MS      = 1000;
const REQUEST_TIMEOUT_MS = 8000;
const BULLET             = '\u2022';

const sectionsRoot = document.querySelector('#sections');
const template     = document.querySelector('#sport-template');
const themeToggle  = document.querySelector('#theme-toggle');

const state = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────────
const isLiveStatus = (s = '') => /\b(live|inprogress|in.?progress|ongoing)\b/i.test(s);

function formatPacificTime(isoValue) {
  if (!isoValue) return 'TBD';
  let date;
  try { date = new Date(isoValue); } catch { return 'TBD'; }
  if (!date || Number.isNaN(date.getTime())) return 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Los_Angeles'
  }).format(date) + ' PT';
}

async function fetchWithTimeout(url, ms = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: text?.slice(0, 180) || `HTTP ${res.status}` }; }
}

// ── Theme ────────────────────────────────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'dark'
    ? '\u2600\uFE0F Light mode'
    : '\uD83C\uDF19 Dark mode';
  localStorage.setItem('theme', theme);
}
function initTheme() { setTheme(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'); }

// ── Render ───────────────────────────────────────────────────────────────────
function renderTeam(container, name, code, score) {
  container.innerHTML = `<div class="abbr">${code || ''}</div><div>${name || 'TBD'}</div><div class="score">${score ?? '-'}</div>`;
}

function setActiveChip(sportKey, label) {
  const ss = state.get(sportKey);
  if (!ss) return;
  for (const chip of ss.root.querySelectorAll('.game-chip'))
    chip.classList.toggle('active', chip.dataset.label === label);
}

function updateLolStreamButton(ss, match) {
  if (!ss?.streamRow || !ss?.streamBtn) return;
  const url = typeof match?.streamUrl === 'string' ? match.streamUrl.trim() : '';
  ss.streamRow.hidden   = !url;
  ss.streamBtn.disabled = !url;
  ss.streamBtn.dataset.url = url;
}

function clearPolling(ss) {
  if (ss.pollTimer) { clearInterval(ss.pollTimer); ss.pollTimer = null; }
}

function renderTrackedMatch(sportKey, data) {
  const ss = state.get(sportKey);
  if (!ss) return;

  if (sportKey === 'nba') {
    renderTeam(ss.awayEl, `${data.away.city} ${data.away.name}`, data.away.code, data.away.score);
    renderTeam(ss.homeEl, `${data.home.city} ${data.home.name}`, data.home.code, data.home.score);
    ss.statusEl.textContent = data.status;
    ss.clockEl.textContent  = `${data.clock} ${BULLET} ${formatPacificTime(data.startTime)} ${BULLET} ${data.gameId}`;
    return;
  }

  const parts = String(data.label || 'TBD vs TBD').split(/\s+vs\s+/i);
  const [s1, s2] = String(data.score || '').split('-');
  renderTeam(ss.awayEl, parts[0] || 'TBD', '', s1 || '-');
  renderTeam(ss.homeEl, parts[1] || 'TBD', '', s2 || '-');
  ss.statusEl.textContent = `${data.league || ''} ${BULLET} ${data.status || ''}`;
  ss.clockEl.textContent  = `${formatPacificTime(data.startTime)} ${BULLET} ${data.matchId || ''}`;
}

// ── Fetch + Poll ─────────────────────────────────────────────────────────────
async function fetchTrack(sportKey, query, silent = false) {
  const ss = state.get(sportKey);
  if (!ss) return;
  try {
    const res     = await fetchWithTimeout(`/api/track?sport=${encodeURIComponent(sportKey)}&query=${encodeURIComponent(query)}`);
    const payload = await safeJson(res);
    if (!res.ok) {
      if (!silent) ss.errorEl.textContent = payload.error || 'Could not track game.';
      if (payload.warning) ss.helpEl.textContent = `Fallback: ${payload.warning}`;
      return;
    }
    renderTrackedMatch(sportKey, payload.match);
    if (sportKey === 'lol') updateLolStreamButton(ss, payload.match);
    ss.helpEl.textContent  = payload.warning ? `Fallback: ${payload.warning}` : 'Upcoming in next 12 hours:';
    ss.errorEl.textContent = '';
  } catch {
    if (!silent) ss.errorEl.textContent = 'Could not reach tracking endpoint.';
  }
}

function startTracking(sportKey, query) {
  const ss = state.get(sportKey);
  if (!ss) return;
  clearPolling(ss);
  ss.currentQuery         = query;
  ss.scoreEl.hidden       = false;
  ss.statusEl.textContent = 'Loading\u2026';
  ss.clockEl.textContent  = '';
  if (sportKey === 'lol') updateLolStreamButton(ss, null);
  setActiveChip(sportKey, query);
  fetchTrack(sportKey, query, false);
  ss.pollTimer = setInterval(() => fetchTrack(sportKey, ss.currentQuery, true), TRACK_POLL_MS);
}

// ── Chips ────────────────────────────────────────────────────────────────────
const gameIdentity = (g) => String(g.matchId || g.gameId || g.label || '').trim();

function buildChip(sportKey, game) {
  const live = isLiveStatus(game.status);
  const btn  = document.createElement('button');
  btn.type      = 'button';
  btn.className = `game-chip${live ? ' chip-live' : ''}`;
  btn.dataset.label = game.label;
  const timeStr = live ? 'LIVE' : formatPacificTime(game.startTime);
  btn.textContent = `${game.label} ${BULLET} ${game.status} ${BULLET} ${timeStr}`;
  btn.addEventListener('click', () => {
    const ss = state.get(sportKey);
    if (ss) ss.input.value = game.label;
    startTracking(sportKey, game.label);
  });
  return btn;
}

// ── Load sport data ───────────────────────────────────────────────────────────
async function loadSportData(sportKey) {
  const ss = state.get(sportKey);
  if (!ss) return;
  try {
    const res  = await fetchWithTimeout(`/api/games?sport=${encodeURIComponent(sportKey)}`);
    const data = await safeJson(res);

    if (!res.ok) { ss.helpEl.textContent = data.error || 'Could not load matches.'; return; }
    if (!data.games?.length) { ss.helpEl.textContent = 'No matches found right now.'; return; }

    ss.helpEl.textContent = data.warning ? `Fallback: ${data.warning}` : 'Upcoming in next 12 hours:';

    ss.liveEl.innerHTML     = '';
    ss.upcomingEl.innerHTML = '';
    ss.allEl.innerHTML      = '';

    // Separate: live | upcoming (not live) | rest
    const liveGames     = data.games.filter((g) => isLiveStatus(g.status));
    const upcomingGames = (data.upcoming || []).filter((g) => !isLiveStatus(g.status));
    const usedIds       = new Set([...liveGames, ...upcomingGames].map(gameIdentity));
    const restGames     = data.games.filter((g) => !usedIds.has(gameIdentity(g))).slice(0, 20);

    // Live section
    if (liveGames.length) {
      ss.liveHeaderEl.hidden = false;
      for (const g of liveGames) ss.liveEl.appendChild(buildChip(sportKey, g));
    } else {
      ss.liveHeaderEl.hidden = true;
    }

    // Upcoming section
    if (upcomingGames.length) {
      for (const g of upcomingGames) ss.upcomingEl.appendChild(buildChip(sportKey, g));
    } else if (!liveGames.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No matches scheduled in the next 12 hours.';
      ss.upcomingEl.appendChild(p);
    }

    // Scheduled rest
    for (const g of restGames) ss.allEl.appendChild(buildChip(sportKey, g));

    // Auto-track: live first, then upcoming, then scheduled
    const autoTrack = liveGames[0] || upcomingGames[0] || restGames[0];
    if (autoTrack) {
      ss.input.value = autoTrack.label;
      startTracking(sportKey, autoTrack.label);
    }
  } catch {
    ss.helpEl.textContent = 'Could not load matches. Check your API routes.';
  }
}

// ── Mount sections ────────────────────────────────────────────────────────────
function mountSportSection(sport) {
  const node = template.content.cloneNode(true);
  const root = node.querySelector('[data-sport-card]');
  root.querySelector('[data-title]').textContent = sport.label;

  const form         = root.querySelector('[data-form]');
  const input        = root.querySelector('[data-input]');
  const helpEl       = root.querySelector('[data-help]');
  const liveHeaderEl = root.querySelector('[data-live-header]');
  const liveEl       = root.querySelector('[data-live]');
  const upcomingEl   = root.querySelector('[data-upcoming]');
  const allEl        = root.querySelector('[data-all]');
  const streamRow    = root.querySelector('[data-stream-row]');
  const streamBtn    = root.querySelector('[data-stream-btn]');
  const scoreEl      = root.querySelector('[data-score]');
  const awayEl       = root.querySelector('[data-away]');
  const homeEl       = root.querySelector('[data-home]');
  const statusEl     = root.querySelector('[data-status]');
  const clockEl      = root.querySelector('[data-clock]');
  const errorEl      = root.querySelector('[data-error]');

  if (sport.key === 'lol') {
    streamRow.hidden   = false;
    streamBtn.disabled = true;
    streamBtn.addEventListener('click', () => {
      const url = streamBtn.dataset.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  state.set(sport.key, {
    root, form, input, helpEl, liveHeaderEl, liveEl,
    upcomingEl, allEl, streamRow, streamBtn,
    scoreEl, awayEl, homeEl, statusEl, clockEl, errorEl,
    pollTimer: null, currentQuery: ''
  });

  form.addEventListener('submit', (e) => { e.preventDefault(); startTracking(sport.key, input.value); });
  sectionsRoot.appendChild(root);
}

for (const sport of sports) mountSportSection(sport);
for (const sport of sports) loadSportData(sport.key);

initTheme();
themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(cur === 'light' ? 'dark' : 'light');
});

window.addEventListener('beforeunload', () => {
  for (const ss of state.values()) clearPolling(ss);
});
'@

# ===========================================================================
# Summary
# ===========================================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Done! 6 files patched (UTF-8, no BOM)." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host @"

  vercel.json           maxDuration 15s
  lib/data-cache.js     stale-while-revalidate, 800ms TTL
  lib/providers.js      LoL hardcoded key, CS2 freshness guard, VALORANT fix
  public/index.html     new [data-live] section in template
  public/styles.css     green live-chip styles
  public/app.js         live section logic, \uXXXX encoding, robust time parse

  Next steps:
    git add -A
    git commit -m "fix: encoding bullets, LoL 403, CS2 stale, VALORANT timestamps, live section"
    git push          <- Vercel auto-deploys

  Optional env var in Vercel dashboard:
    LOL_API_KEY = 0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z
"@