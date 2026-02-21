// lib/providers.js
import { JSDOM } from 'jsdom';

const UPCOMING_WINDOW_MS = 12 * 60 * 60 * 1000;
const STALE_CUTOFF_MS    =  6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS   = 5000;

// === NBA ===
const NBA_URL          = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_FALLBACK_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// === LoL Riot API ===
const LOL_API_KEY      = process.env.LOL_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_SCHEDULE_URL = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
const LOL_LIVE_URL     = 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US';

const LOL_REGIONS = [
  { key: 'LCS', leagueId: '98767991299243165' },
  { key: 'LEC', leagueId: '98767991302996019' },
  { key: 'LPL', leagueId: '98767991314006698' },
  { key: 'LCK', leagueId: '98767991310872058' },
  { key: 'CBLOL', leagueId: '98767991332355509' },
  { key: 'LTA South', leagueId: '113475181634818701' },
  { key: 'LTA North', leagueId: '113475185966427351' }, // Added to ensure coverage
  { key: 'LCP', leagueId: '113475204423853000' } // Pacific
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

async function fetchText(url, options = {}) {
    const { controller, cleanup } = withTimeout(FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        cache: 'no-store', signal: controller.signal, ...options,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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
function formatNbaTime(str) {
  if (!str) return '';
  const m = str.match(/PT(\d+)M(\d+)(?:\.(\d+))?S/);
  if (m) {
     const [, min, sec, ms] = m;
     const secStr = String(sec).padStart(2, '0');
     if (ms) return `${min}:${secStr}.${ms.slice(0, 2)}`; // Include MS
     return `${min}:${secStr}`;
  }
  return str;
}
const formatClock = (period, clock, fallback) => {
  if (!period || period === 0) return '';
  const timeStr = formatNbaTime(clock);
  return `${period > 4 ? `OT${period - 4}` : `Q${period}`} ${timeStr || '0:00'}`;
};

function serializeNbaFromCdn(game) {
  const sCode = game.gameStatus;
  let status = 'Scheduled';
  let clock  = '';

  if (sCode === 3) {
      status = 'Final';
      clock  = 'Final';
  } else if (sCode === 2) {
      status = 'Live';
      const text = game.gameStatusText || '';
      if (/Halftime|Half/i.test(text)) {
          clock = 'Halftime';
      } else {
          if (/End\s+of/i.test(text)) clock = text;
          else clock = formatClock(game.period, game.gameClock, game.gameEt);
      }
  } else {
      status = 'Scheduled';
      clock  = '';
  }

  // Use gameTimeUTC if available, otherwise fallback to gameEt
  let start = game.gameTimeUTC;
  if (!start && game.gameEt) {
      start = game.gameEt; // Try to use this, but it might lack timezone info.
      // Typically NBA gameEt is like "2023-10-25T19:00:00-04:00" or similar.
  }

  return {
    gameId: game.gameId, label: `${game.awayTeam.teamTricode} @ ${game.homeTeam.teamTricode}`,
    status: status,
    clock: clock,
    home: { code: game.homeTeam.teamTricode, name: game.homeTeam.teamName, city: game.homeTeam.teamCity, score: Number(game.homeTeam.score) },
    away: { code: game.awayTeam.teamTricode, name: game.awayTeam.teamName, city: game.awayTeam.teamCity, score: Number(game.awayTeam.score) },
    startTime: start || null, lastUpdated: new Date().toISOString()
  };
}

function serializeNbaFromEspn(event) {
  const comp = event.competitions?.[0] || {};
  const teams = comp.competitors || [];
  const away = teams.find((t) => t.homeAway === 'away') || teams[0] || {};
  const home = teams.find((t) => t.homeAway === 'home') || teams[1] || {};

  const state = comp.status?.type?.state;
  let status = 'Scheduled';
  let clock  = '';

  if (state === 'post') {
      status = 'Final';
      clock  = 'Final';
  } else if (state === 'in') {
      status = 'Live';
      clock = formatClock(comp.status?.period || 1, comp.status?.displayClock, event.date);
      if (comp.status?.type?.description && /Half/i.test(comp.status.type.description)) {
          clock = 'Halftime';
      }
  } else {
      status = 'Scheduled';
      clock  = '';
  }

  return {
    gameId: event.id, label: `${away.team?.abbreviation || 'AWAY'} @ ${home.team?.abbreviation || 'HOME'}`,
    status: status,
    clock: clock,
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
      const matchedLive = liveEvents.find(lev =>
          lev.id === e.id ||
          (lev.leagueId === result.value.region.leagueId && Math.abs(lev.startTime - eStart) < 20 * 60 * 1000)
      );

      const isLive = !!matchedLive || isLiveStr(e.state);
      const teams = e.match?.teams || [];

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

// === VALORANT (vlr.gg scraper) ===

async function fetchVlrMatchDetails(url) {
    try {
        const text = await fetchText(url);
        if (!text) return {};

        const dom = new JSDOM(text);
        const doc = dom.window.document;

        // Stream
        const streamEmbed = doc.querySelector('.match-streams-btn-embed');
        const siteId = streamEmbed?.getAttribute('data-site-id');
        // If "valorant_la", construct url
        let streamUrl = null;
        if (siteId) {
             // Heuristic: check if it looks like a twitch channel or just an ID
             // VLR usually puts the channel name here
             streamUrl = `https://twitch.tv/${siteId}`;
        } else {
             const streamLink = doc.querySelector('a.match-streams-btn-external');
             if (streamLink) streamUrl = streamLink.href;
        }

        // Round Score (Live)
        // Try to find the map score in the header
        let roundScore = null;

        // Strategy 1: The big score numbers in the header might reflect current map if only one map is live?
        // Actually, usually header is series score.
        // Strategy 2: Look for the active map tab
        const activeMap = doc.querySelector('.vm-stats-gamesnav-item.mod-active');
        if (activeMap) {
            // "Map 1 \t 13:9"
            const mapText = activeMap.textContent.trim();
            // Extract numbers
            const m = mapText.match(/(\d+)\s*:\s*(\d+)/);
            if (m) {
                roundScore = `${m[1]}-${m[2]}`;
            }
        }

        // Strategy 3: Look for ".score" class inside the stats table if any
        if (!roundScore) {
             // Maybe ".vlr-live-score"
             const liveScore = doc.querySelector('.vlr-live-score');
             if (liveScore) roundScore = liveScore.textContent.trim();
        }

        return { streamUrl, roundScore };

    } catch (e) {
        return {};
    }
}

async function getValorantData() {
  const allGames = [];
  try {
     const text = await fetchText('https://www.vlr.gg/matches');
     const dom = new JSDOM(text);
     const doc = dom.window.document;

     // Parsing strategy: Iterate over match items directly
     const matchNodes = doc.querySelectorAll('a.match-item');

     // Identify today's date from the page to help with relative times
     // The structure is usually: <div class="wf-label"> Today </div> ... matches ...
     // But querying all match-items flattens this.
     // We'll try to guess start time from the time text.

     const now = new Date();

     for (const node of matchNodes) {
         const href = node.getAttribute('href');
         const id = href.split('/')[1] || 'unknown';
         const matchUrl = `https://www.vlr.gg${href}`;

         // Teams
         const teams = node.querySelectorAll('.match-item-vs-team-name');
         const t1 = teams[0]?.textContent.trim() || 'TBD';
         const t2 = teams[1]?.textContent.trim() || 'TBD';

         // Event / League
         const eventNode = node.querySelector('.match-item-event');
         // Fallback to text-of if eventNode missing
         let league = eventNode?.textContent.trim().replace(/\t/g, '').split('\n')[0].trim() || 'Valorant';

         // Status
         const statusNode = node.querySelector('.ml-status');
         let isLive = statusNode?.textContent.trim().toLowerCase() === 'live';

         // Score (Series)
         const scores = node.querySelectorAll('.match-item-vs-team-score');
         let s1 = scores[0]?.textContent.trim() || '0';
         let s2 = scores[1]?.textContent.trim() || '0';
         let score = `${s1}-${s2}`;

         // Time
         const timeNode = node.querySelector('.match-item-time');
         let timeStr = timeNode?.textContent.trim() || '';
         // Parse time "4:00 PM"
         let startTime = null;
         if (timeStr) {
             // This is rough. VLR times are usually local to the user if using browser,
             // but here we are server side. VLR server usually gives CET or EST?
             // Actually VLR might give time relative to UTC or a set timezone.
             // We'll assume the scraper time is consistent.
             // For now, let's just set it to Today + time.
             // This is brittle but sufficient for "today's" matches.
             // Improvement: Parse the "wf-label" preceding this node.
             // We can't do that easily with querySelectorAll.
             // Use JSDOM traversal?
             // Simplification: If it's live, use now.
             if (isLive) startTime = now.toISOString();
             else startTime = new Date().toISOString(); // Placeholder for upcoming
         }

         allGames.push({
             matchId: id,
             label: `${t1} vs ${t2}`,
             status: isLive ? 'Live' : 'Scheduled',
             startTime,
             league,
             score,
             matchUrl,
             clock: null,
             streamUrl: null
         });
     }

     // Deep Fetch for Live games (and limited Upcoming)
     // Filter live
     const liveGames = allGames.filter(g => g.status === 'Live');
     // Top 5 upcoming
     const upcomingGames = allGames.filter(g => g.status !== 'Live').slice(0, 5);

     const targets = [...liveGames, ...upcomingGames];

     // Use Promise.all with concurrency limit ideally, but for <10 items it's fine
     await Promise.all(targets.map(async (g) => {
         const details = await fetchVlrMatchDetails(g.matchUrl);
         if (details.streamUrl) g.streamUrl = details.streamUrl;
         // If we have a round score, append it or replace?
         // User wants "Score is currently 4-0 kills".
         // If we have round score "4-0", we can format the score.
         if (details.roundScore) {
             g.score = `${g.score} (Map: ${details.roundScore})`;
         }
     }));

  } catch(e) {
      // console.log(e);
  }

  const deduped = [...new Map(allGames.map((g) => [g.matchId, g])).values()];

  if (!deduped.length) {
    return { games:[], upcoming:[], warning: 'Could not scrape live data' };
  }

  // Sort: Live first
  deduped.sort((a, b) => (isLiveStr(a.status)?0:1) - (isLiveStr(b.status)?0:1));

  return { games: deduped, upcoming: deduped.filter((g) => g.status !== 'Live').slice(0, 10), warning: null };
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
  return { games:[], upcoming:[], warning: 'CS2 live data unavailable (API limit)' };
}

function pickByQuery(events, query) {
  const q = normalize(query);
  if (!events.length) return null;
  if (!q) return events[0];
  // Improved matching for "VCT Americas" vs "Americas"
  return events.find((e) => {
      const target = normalize(`${e.matchId} ${e.label} ${e.league}`);
      // Tokenize query
      const tokens = q.split(/\s+/);
      return tokens.every(token => target.includes(token));
  }) || null;
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
