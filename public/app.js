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
  const ms = String(d.getMilliseconds()).padStart(3, '0').slice(0, 2); // 2 digits
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  globalRefreshEl.textContent = `Refreshed at: ${h}:${m}:${s}:${ms} ${ampm}`;
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const isLiveStatus = (s = '') => /\b(live|inprogress|in.?progress|ongoing|halftime)\b/i.test(s);

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

function updateLolStreamButton(ss, match) {
  if (!ss?.streamRow || !ss?.streamBtn) return;
  const url = typeof match?.streamUrl === 'string' ? match.streamUrl.trim() : '';
  ss.streamRow.hidden   = !url;
  ss.streamBtn.disabled = !url;
  ss.streamBtn.dataset.url = url;
}

function clearPolling(ss) {
  if (ss.pollTimer) { clearInterval(ss.pollTimer); ss.pollTimer = null; }
  if (ss.tickTimer) { clearInterval(ss.tickTimer); ss.tickTimer = null; }
}

function renderTrackedMatch(sportKey, data) {
  const ss = state.get(sportKey);
  if (!ss) return;

  updateGlobalRefresh();

  if (sportKey === 'nba') {
    renderTeam(ss.awayEl, `${data.away.city} ${data.away.name}`, data.away.code, data.away.score);
    renderTeam(ss.homeEl, `${data.home.city} ${data.home.name}`, data.home.code, data.home.score);

    // Status cleanup: if status duplicates clock (e.g. Final), hide it or clock.
    // Provider now returns "Live", "Final", or "Scheduled".
    let cleanStatus = data.status;
    let clockText   = data.clock || '';

    // If status is Final and clock is Final, just show status
    if (cleanStatus === 'Final' && clockText === 'Final') {
        clockText = '';
    }
    // If status is Live, and clock has content, just show clock + status?
    // User wants no duplicates.
    // If cleanStatus is "Live", and clock is "Q3 ...", that's fine.

    ss.statusEl.textContent = cleanStatus;

    // If live/active, don't show the start time in clock
    const isLive = isLiveStatus(data.status) || /Q\d|OT|Half|Live/i.test(data.status);
    const timeInfo = isLive ? '' : ` ${BULLET} ${formatPacificTime(data.startTime)}`;

    const displayClock = `${clockText}${timeInfo}`;
    ss.clockEl.textContent = displayClock;

    // Countdown Logic for NBA
    if (ss.tickTimer) { clearInterval(ss.tickTimer); ss.tickTimer = null; }

    // Check if we can countdown: must be live, not halftime, and contain a time "M:SS"
    if (isLive && /\d+:\d+/.test(clockText) && !/Half|End|Final/i.test(clockText)) {
        // Parse time. Last occurrence of D:DD
        const matches = clockText.match(/(\d+):(\d+)(?:\.(\d+))?/g);
        if (matches) {
            const lastTime = matches[matches.length - 1];
            // Split into components
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
                    // Reconstruct string
                    const newTime = `${minutes}:${String(seconds).padStart(2, '0')}`;
                    // Replace the time in the display string
                    ss.clockEl.textContent = displayClock.replace(lastTime, newTime);
                }, 1000);
            }
        }
    }

    return;
  }

  const parts = String(data.label || 'TBD vs TBD').split(/\s+vs\s+/i);
  let [s1, s2] = String(data.score || '').split('|');
  if (s2 === undefined) [s1, s2] = String(data.score || '').split('-');
  renderTeam(ss.awayEl, parts[0] || 'TBD', '', s1 || '-');
  renderTeam(ss.homeEl, parts[1] || 'TBD', '', s2 || '-');
  ss.statusEl.textContent = `${data.league || ''} ${BULLET} ${data.status || ''}`;
  ss.clockEl.textContent  = `${data.clock || formatPacificTime(data.startTime)} ${BULLET} ${data.matchId || ''}`;
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

// â”€â”€ Chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Using global refresher now, but can keep this or remove it.
    // User asked for "at the top", so global is primary.
    if (ss.refreshTimeEl) {
        ss.refreshTimeEl.textContent = ''; // Hide per-card refresh
    }
    updateGlobalRefresh();

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
    // User requested "Only include matches upcoming matches 12 hours from now"
    // So we will HIDE restGames strictly.
    // Use this section only if we want to show everything.
    // for (const g of restGames) ss.allEl.appendChild(buildChip(sportKey, g));

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