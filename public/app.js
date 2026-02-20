const sports = [
  { key: 'nba', label: 'NBA' },
  { key: 'lol', label: 'League of Legends Esports' },
  { key: 'csgo', label: 'CS2 / CSGO Esports' },
  { key: 'valorant', label: 'VALORANT Esports' }
];

const sectionsRoot = document.querySelector('#sections');
const template = document.querySelector('#sport-template');
const themeToggle = document.querySelector('#theme-toggle');

const state = new Map();

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

function connectStream(sportKey, query) {
  const sportState = state.get(sportKey);
  if (!sportState) return;

  if (sportState.stream) sportState.stream.close();
  sportState.errorEl.textContent = '';
  sportState.scoreEl.hidden = false;
  sportState.statusEl.textContent = 'Connecting…';
  sportState.clockEl.textContent = '';

  setActiveChip(sportKey, query);

  const stream = new EventSource(`/api/stream?sport=${encodeURIComponent(sportKey)}&query=${encodeURIComponent(query)}`);
  sportState.stream = stream;

  stream.addEventListener('score', (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      sportState.errorEl.textContent = data.error;
      return;
    }

    if (sportKey === 'nba') {
      renderTeam(sportState.awayEl, `${data.away.city} ${data.away.name}`, data.away.code, data.away.score);
      renderTeam(sportState.homeEl, `${data.home.city} ${data.home.name}`, data.home.code, data.home.score);
      sportState.statusEl.textContent = data.status;
      sportState.clockEl.textContent = `${data.clock} • ${data.gameId}`;
      return;
    }

    const [awayName, homeName] = String(data.label || 'TBD vs TBD').split(/\s+vs\s+/i);
    renderTeam(sportState.awayEl, awayName, '', data.score?.split?.('-')?.[0]);
    renderTeam(sportState.homeEl, homeName, '', data.score?.split?.('-')?.[1]);
    sportState.statusEl.textContent = `${data.league || ''} • ${data.status || ''}`;
    sportState.clockEl.textContent = `${data.startTime || 'TBD'} • ${data.matchId || ''}`;
  });

  stream.onerror = () => {
    sportState.errorEl.textContent = 'Live stream interrupted — retrying…';
  };
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
    connectStream(sportKey, game.label);
  });
  return btn;
}

async function loadSportData(sportKey) {
  const sportState = state.get(sportKey);
  if (!sportState) return;

  try {
    const res = await fetch(`/api/games?sport=${encodeURIComponent(sportKey)}`);
    const data = await res.json();

    if (!data.games?.length) {
      sportState.helpEl.textContent = 'No matches found right now.';
      return;
    }

    sportState.helpEl.textContent = 'Upcoming in next 12 hours:';
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

    const top = data.games.slice(0, 20);
    for (const game of top) sportState.allEl.appendChild(buildChip(sportKey, game));

    sportState.input.value = top[0].label;
    connectStream(sportKey, top[0].label);
  } catch {
    sportState.helpEl.textContent = 'Could not load matches from upstream APIs in this environment.';
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
    stream: null
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    connectStream(sport.key, input.value);
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
