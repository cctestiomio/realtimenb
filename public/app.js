const sports = [
  { key: 'nba', label: 'NBA' },
  { key: 'lol', label: 'League of Legends Esports' },
  { key: 'csgo', label: 'CS2 / CSGO Esports' },
  { key: 'valorant', label: 'VALORANT Esports' }
];

const TRACK_POLL_MS = 3000;

const sectionsRoot = document.querySelector('#sections');
const template = document.querySelector('#sport-template');
const themeToggle = document.querySelector('#theme-toggle');

const state = new Map();

function formatPacificTime(isoValue) {
  if (!isoValue) return 'TBD';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return String(isoValue);
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles'
  }).format(date);
  return `${formatted} PST (GMT-8)`;
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text?.slice(0, 180) || `HTTP ${res.status}` };
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  setTheme(saved === 'dark' ? 'dark' : 'light');
}

function renderTeam(container, name, code, score) {
  container.innerHTML = `
    <div class="abbr">${code || ''}</div>
    <div>${name || 'TBD'}</div>
    <div class="score">${score ?? '-'}</div>
  `;
}

function setActiveChip(sportKey, selectedLabel) {
  const sportState = state.get(sportKey);
  if (!sportState) return;
  const chips = sportState.root.querySelectorAll('.game-chip');
  for (const chip of chips) {
    chip.classList.toggle('active', chip.dataset.label === selectedLabel);
  }
}

function clearPolling(sportState) {
  if (sportState.pollTimer) {
    clearInterval(sportState.pollTimer);
    sportState.pollTimer = null;
  }
}

function renderTrackedMatch(sportKey, data) {
  const sportState = state.get(sportKey);
  if (!sportState) return;

  if (sportKey === 'nba') {
    renderTeam(sportState.awayEl, `${data.away.city} ${data.away.name}`, data.away.code, data.away.score);
    renderTeam(sportState.homeEl, `${data.home.city} ${data.home.name}`, data.home.code, data.home.score);
    sportState.statusEl.textContent = data.status;
    const startText = formatPacificTime(data.startTime);
    sportState.clockEl.textContent = `${data.clock} • ${startText} • ${data.gameId}`;
    return;
  }

  const [awayName, homeName] = String(data.label || 'TBD vs TBD').split(/\s+vs\s+/i);
  const parsedScores = String(data.score || '').split('-');
  renderTeam(sportState.awayEl, awayName, '', parsedScores[0] || '-');
  renderTeam(sportState.homeEl, homeName, '', parsedScores[1] || '-');
  sportState.statusEl.textContent = `${data.league || ''} • ${data.status || ''}`;
  sportState.clockEl.textContent = `${formatPacificTime(data.startTime)} • ${data.matchId || ''}`;
}

async function fetchTrack(sportKey, query, { silent = false } = {}) {
  const sportState = state.get(sportKey);
  if (!sportState) return;

  try {
    const res = await fetch(`/api/track?sport=${encodeURIComponent(sportKey)}&query=${encodeURIComponent(query)}`);
    const payload = await safeJson(res);

    if (!res.ok) {
      if (!silent) sportState.errorEl.textContent = payload.error || 'Could not track game.';
      if (payload.warning) sportState.helpEl.textContent = `Using fallback data: ${payload.warning}`;
      return;
    }

    renderTrackedMatch(sportKey, payload.match);
    if (payload.warning) {
      sportState.helpEl.textContent = `Using fallback data: ${payload.warning}`;
    } else {
      sportState.helpEl.textContent = 'Upcoming in next 12 hours:';
    }
    sportState.errorEl.textContent = '';
  } catch {
    if (!silent) sportState.errorEl.textContent = 'Could not reach tracking endpoint. Please retry.';
  }
}

function startTracking(sportKey, query) {
  const sportState = state.get(sportKey);
  if (!sportState) return;

  clearPolling(sportState);
  sportState.currentQuery = query;
  sportState.scoreEl.hidden = false;
  sportState.statusEl.textContent = 'Loading…';
  sportState.clockEl.textContent = '';

  setActiveChip(sportKey, query);

  fetchTrack(sportKey, query);
  sportState.pollTimer = setInterval(() => {
    fetchTrack(sportKey, sportState.currentQuery, { silent: true });
  }, TRACK_POLL_MS);
}


function gameIdentity(game) {
  return String(game.matchId || game.gameId || game.label || '').trim();
}

function buildChip(sportKey, game) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'game-chip';
  btn.dataset.label = game.label;
  btn.textContent = `${game.label} • ${game.status}`;
  btn.addEventListener('click', () => {
    const sportState = state.get(sportKey);
    sportState.input.value = game.label;
    startTracking(sportKey, game.label);
  });
  return btn;
}

async function loadSportData(sportKey) {
  const sportState = state.get(sportKey);
  if (!sportState) return;

  try {
    const res = await fetch(`/api/games?sport=${encodeURIComponent(sportKey)}`);
    const data = await safeJson(res);

    if (!res.ok) {
      sportState.helpEl.textContent = data.error || 'Could not load matches for this sport.';
      return;
    }

    if (!data.games?.length) {
      sportState.helpEl.textContent = 'No matches found right now.';
      return;
    }

    sportState.helpEl.textContent = data.warning ? `Using fallback data: ${data.warning}` : 'Upcoming in next 12 hours:';
    sportState.upcomingEl.innerHTML = '';
    sportState.allEl.innerHTML = '';

    const upcoming = data.upcoming?.length ? data.upcoming : [];
    if (upcoming.length) {
      for (const game of upcoming) sportState.upcomingEl.appendChild(buildChip(sportKey, game));
    } else {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No matches scheduled in the next 12 hours.';
      sportState.upcomingEl.appendChild(none);
    }

    const upcomingIds = new Set(upcoming.map(gameIdentity));
    const top = data.games.filter((game) => !upcomingIds.has(gameIdentity(game))).slice(0, 20);

    if (top.length) {
      for (const game of top) sportState.allEl.appendChild(buildChip(sportKey, game));
      sportState.input.value = top[0].label;
      startTracking(sportKey, top[0].label);
    } else if (upcoming.length) {
      sportState.input.value = upcoming[0].label;
      startTracking(sportKey, upcoming[0].label);
    }
  } catch {
    sportState.helpEl.textContent = 'Could not load matches right now. Check your Vercel API routes and retry.';
  }
}

function mountSportSection(sport) {
  const node = template.content.cloneNode(true);
  const root = node.querySelector('[data-sport-card]');
  root.querySelector('[data-title]').textContent = sport.label;

  const form = root.querySelector('[data-form]');
  const input = root.querySelector('[data-input]');
  const helpEl = root.querySelector('[data-help]');
  const upcomingEl = root.querySelector('[data-upcoming]');
  const allEl = root.querySelector('[data-all]');
  const scoreEl = root.querySelector('[data-score]');
  const awayEl = root.querySelector('[data-away]');
  const homeEl = root.querySelector('[data-home]');
  const statusEl = root.querySelector('[data-status]');
  const clockEl = root.querySelector('[data-clock]');
  const errorEl = root.querySelector('[data-error]');

  state.set(sport.key, {
    root,
    form,
    input,
    helpEl,
    upcomingEl,
    allEl,
    scoreEl,
    awayEl,
    homeEl,
    statusEl,
    clockEl,
    errorEl,
    pollTimer: null,
    currentQuery: ''
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    startTracking(sport.key, input.value);
  });

  sectionsRoot.appendChild(root);
}

for (const sport of sports) mountSportSection(sport);
for (const sport of sports) loadSportData(sport.key);

initTheme();
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'light' ? 'dark' : 'light');
});

window.addEventListener('beforeunload', () => {
  for (const sportState of state.values()) clearPolling(sportState);
});
