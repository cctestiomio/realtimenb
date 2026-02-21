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
const globalRefreshEl = document.querySelector('#global-refresh-time');

const state = new Map();

function updateGlobalRefresh() {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0').slice(0, 2);
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  globalRefreshEl.textContent = `Refreshed at: ${h}:${m}:${s}:${ms} ${ampm}`;
}

const isLiveStatus = (s = '') => /\b(live|inprogress|in.?progress|ongoing|halftime)\b/i.test(s);

function formatPacificTime(isoValue) {
  if (!isoValue) return 'TBD';
  let date;
  try {
      // Ensure ISO string is treated as UTC if no timezone specified
      if (typeof isoValue === 'string' && !isoValue.endsWith('Z') && !isoValue.includes('+') && !isoValue.includes('-')) {
          isoValue += 'Z';
      }
      date = new Date(isoValue);
  } catch { return 'TBD'; }
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

// â”€â”€ Theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'dark'
    ? '\u2600\uFE0F Light mode'
    : '\uD83C\uDF19 Dark mode';
  localStorage.setItem('theme', theme);
}
function initTheme() { setTheme(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'); }

// â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderTeam(container, name, code, score) {
  container.innerHTML = `<div class="abbr">${code || ''}</div><div>${name || 'TBD'}</div><div class="score">${score ?? '-'}</div>`;
}

function setActiveChip(sportKey, label) {
  const ss = state.get(sportKey);
  if (!ss) return;
  for (const chip of ss.root.querySelectorAll('.game-chip'))
    chip.classList.toggle('active', chip.dataset.label === label);
}

function updateStreamButton(ss, match) {
  if (!ss?.streamRow || !ss?.streamBtn) return;
  const url = typeof match?.streamUrl === 'string' ? match.streamUrl.trim() : '';
  ss.streamRow.hidden   = !url;
  ss.streamBtn.disabled = !url;
  // Remove old listeners to avoid duplicates?
  // Easier to just set onclick property which overwrites.
  ss.streamBtn.onclick = () => {
     if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };
}

function clearPolling(ss) {
  if (ss.pollTimer) { clearInterval(ss.pollTimer); ss.pollTimer = null; }
  if (ss.tickTimer) { clearInterval(ss.tickTimer); ss.tickTimer = null; }
}

function renderTrackedMatch(sportKey, data) {
  const ss = state.get(sportKey);
  if (!ss) return;

  updateGlobalRefresh();
  updateStreamButton(ss, data);

  if (sportKey === 'nba') {
    renderTeam(ss.awayEl, `${data.away.city} ${data.away.name}`, data.away.code, data.away.score);
    renderTeam(ss.homeEl, `${data.home.city} ${data.home.name}`, data.home.code, data.home.score);

    let cleanStatus = data.status;
    let clockText   = data.clock || '';

    if (cleanStatus === 'Final' && clockText === 'Final') {
        clockText = '';
    }

    ss.statusEl.textContent = cleanStatus;

    const isLive = isLiveStatus(data.status) || /Q\d|OT|Half|Live/i.test(data.status);
    // Only show Start Time if NOT live
    const timeInfo = isLive ? '' : ` ${BULLET} ${formatPacificTime(data.startTime)}`;

    // Clean up displayClock if clockText is empty (avoid leading bullet)
    let displayClock = `${clockText}${timeInfo}`;
    if (!clockText && displayClock.startsWith(` ${BULLET} `)) {
        displayClock = displayClock.replace(` ${BULLET} `, '');
    }
    ss.clockEl.textContent = displayClock;

    // Countdown Logic for NBA
    if (ss.tickTimer) { clearInterval(ss.tickTimer); ss.tickTimer = null; }

    if (isLive && /\d+:\d+/.test(clockText) && !/Half|End|Final/i.test(clockText)) {
        const matches = clockText.match(/(\d+):(\d+)(?:\.(\d+))?/g);
        if (matches) {
            const lastTime = matches[matches.length - 1];
            const mPart = lastTime.match(/(\d+):(\d+)(?:\.(\d+))?/);
            if (mPart) {
                let minutes = parseInt(mPart[1], 10);
                let seconds = parseInt(mPart[2], 10);

                ss.tickTimer = setInterval(() => {
                    if (seconds > 0) {
                        seconds--;
                    } else {
                        if (minutes > 0) {
                            minutes--;
                            seconds = 59;
                        } else {
                            clearInterval(ss.tickTimer);
                            return;
                        }
                    }
                    const newTime = `${minutes}:${String(seconds).padStart(2, '0')}`;
                    // Replace specifically the last time occurrence
                    // We need to be careful not to replace Q1 (if it was Q10?)
                    // Just replace the string we found.
                    ss.clockEl.textContent = displayClock.replace(lastTime, newTime);
                }, 1000);
            }
        }
    }
    return;
  }

  // Generic Esports Render
  const parts = String(data.label || 'TBD vs TBD').split(/\s+vs\s+/i);
  let [s1, s2] = String(data.score || '').split('|');
  if (s2 === undefined) [s1, s2] = String(data.score || '').split('-');

  // Format score to be nicer if map details exist
  // data.score might be "0-0 (Map: 13-9)"

  renderTeam(ss.awayEl, parts[0] || 'TBD', '', s1 || '-');
  renderTeam(ss.homeEl, parts[1] || 'TBD', '', s2 || '-');

  ss.statusEl.textContent = `${data.league || ''} ${BULLET} ${data.status || ''}`;
  ss.clockEl.textContent  = `${data.clock || formatPacificTime(data.startTime)}`;
}

// â”€â”€ Fetch + Poll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  updateStreamButton(ss, null);
  setActiveChip(sportKey, query);
  fetchTrack(sportKey, query, false);
  ss.pollTimer = setInterval(() => fetchTrack(sportKey, ss.currentQuery, true), TRACK_POLL_MS);
}

// â”€â”€ Chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const gameIdentity = (g) => String(g.matchId || g.gameId || g.label || '').trim();

function buildChip(sportKey, game) {
  const live = isLiveStatus(game.status);
  const btn  = document.createElement('button');
  btn.type      = 'button';
  btn.className = `game-chip${live ? ' chip-live' : ''}`;
  btn.dataset.label = game.label;

  let content = '';

  if (live) {
     if (sportKey === 'nba') {
         // User requested: "MIA @ ATL • Q1 4:34 • LIVE"
         const clock = game.clock || 'LIVE';
         // If clock is same as status, don't duplicate
         if (clock === 'LIVE') {
             content = `${game.label} ${BULLET} LIVE`;
         } else {
             content = `${game.label} ${BULLET} ${clock} ${BULLET} LIVE`;
         }
     } else {
         const timeStr = game.clock || 'LIVE';
         content = `${game.label} ${BULLET} ${game.status} ${BULLET} ${timeStr}`;
     }
  } else {
     // Scheduled
     const timeStr = formatPacificTime(game.startTime);
     content = `${game.label} ${BULLET} ${game.status} ${BULLET} ${timeStr}`;
  }

  btn.textContent = content;
  btn.addEventListener('click', () => {
    const ss = state.get(sportKey);
    if (ss) ss.input.value = game.label;
    startTracking(sportKey, game.label);
  });
  return btn;
}

// â”€â”€ Load sport data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    if (ss.refreshTimeEl) ss.refreshTimeEl.textContent = '';
    updateGlobalRefresh();

    const liveGames     = data.games.filter((g) => isLiveStatus(g.status));
    const upcomingGames = (data.upcoming || []).filter((g) => !isLiveStatus(g.status));
    const usedIds       = new Set([...liveGames, ...upcomingGames].map(gameIdentity));
    const restGames     = data.games.filter((g) => !usedIds.has(gameIdentity(g))).slice(0, 20);

    if (liveGames.length) {
      ss.liveHeaderEl.hidden = false;
      for (const g of liveGames) ss.liveEl.appendChild(buildChip(sportKey, g));
    } else {
      ss.liveHeaderEl.hidden = true;
    }

    if (upcomingGames.length) {
      for (const g of upcomingGames) ss.upcomingEl.appendChild(buildChip(sportKey, g));
    } else if (!liveGames.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No matches scheduled in the next 12 hours.';
      ss.upcomingEl.appendChild(p);
    }

    // Auto-track priority
    const autoTrack = liveGames[0] || upcomingGames[0];
    if (autoTrack) {
      ss.input.value = autoTrack.label;
      startTracking(sportKey, autoTrack.label);
    }
  } catch {
    ss.helpEl.textContent = 'Could not load matches. Check your API routes.';
  }
}

// â”€â”€ Mount sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const refreshTimeEl = root.querySelector('[data-refresh-time]');

  // Initialize stream button as hidden
  streamRow.hidden = true;

  state.set(sport.key, {
    root, form, input, helpEl, liveHeaderEl, liveEl,
    upcomingEl, allEl, streamRow, streamBtn,
    scoreEl, awayEl, homeEl, statusEl, clockEl, errorEl, refreshTimeEl,
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
