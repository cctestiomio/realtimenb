
$ErrorActionPreference = 'Stop'

$file = $null
foreach ($candidate in @('lib\providers.js','pages\api\lib\providers.js')) {
    if (Test-Path $candidate) { $file = $candidate; break }
}
if (-not $file) { Write-Error 'Cannot find lib\providers.js'; exit 1 }

Write-Host "Patching: $file" -ForegroundColor Cyan
Copy-Item $file "$file.bak" -Force
$src = [System.IO.File]::ReadAllText((Resolve-Path $file), [System.Text.Encoding]::UTF8)

function Patch($label, $old, $new) {
    if ($script:src.Contains($old)) {
        $script:src = $script:src.Replace($old, $new)
        Write-Host "  [OK] $label" -ForegroundColor Green
    } else {
        Write-Warning "  [SKIP] $label – anchor not found"
    }
}

Patch 'formatNbaTime: handle decimal seconds + strip ms' @'
function formatNbaTime(str) {
  if (!str) return '';
  const m = str.match(/PT(\d+)M(\d+)(?:\.(\d+))?S/);
  if (m) {
    const [, min, sec, ms] = m;
    const secStr = String(sec).padStart(2, '0');
    // Only show decimals if non-zero - prevents "4:43.00" from CDN source
    if (ms && ms.replace(/0/g, '') !== '') return `${min}:${secStr}.${ms.slice(0, 2)}`;
    return `${min}:${secStr}`;
  }
  // ESPN sends plain "4:43" - pass through unchanged
  if (/^\d+:\d+$/.test(str.trim())) return str.trim();
  if (/\d/.test(str)) return str;
  return '';
}
'@ @'
function formatNbaTime(str) {
  if (!str) return '';
  // ISO duration from NBA CDN: PT4M43.00S  – strip fractional seconds always
  const mISO = str.match(/PT(\d+)M(\d+)(?:\.\d+)?S/);
  if (mISO) {
    const [, min, sec] = mISO;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }
  // Plain MM:SS from ESPN e.g. "4:43"
  if (/^\d+:\d+$/.test(str.trim())) return str.trim();
  // Plain decimal-seconds from CDN end-of-period e.g. "48.4" -> "0:48"
  if (/^\d+(\.\d+)?$/.test(str.trim())) {
    const totalSec = parseFloat(str);
    if (!isNaN(totalSec)) {
      const mm = Math.floor(totalSec / 60);
      const ss = Math.floor(totalSec % 60);
      return `${mm}:${String(ss).padStart(2, '0')}`;
    }
  }
  return '';
}
'@

Patch 'getNbaData: CDN-first sequential fetch' @'
async function getNbaData() {
  const tasks = [
    fetchJson(NBA_URL).then(p => ({ games: (p?.scoreboard?.games || []).map(serializeNbaFromCdn) })),
    fetchJson(NBA_FALLBACK_URL).then(p => ({ games: (p?.events || []).map(serializeNbaFromEspn) }))
  ];
  const result = await Promise.any(tasks.map(t => t.catch(e => { throw e; }))).catch(() => null);
  if (!result?.games?.length) return { games: [], upcoming: [], warning: null };
  return {
    games: result.games,
    upcoming: result.games
      .filter(g => inNext12h(parseDate(g.startTime)))
      .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
    warning: null
  };
}
'@ @'
async function getNbaData() {
  // Always prefer CDN (authoritative, consistent clock format).
  // Fall back to ESPN only if CDN fails – never race them simultaneously.
  let result = null;
  try {
    const p     = await fetchJson(NBA_URL);
    const games = (p?.scoreboard?.games || []).map(serializeNbaFromCdn);
    if (games.length) result = { games };
  } catch { /* fall through */ }
  if (!result?.games?.length) {
    try {
      const p     = await fetchJson(NBA_FALLBACK_URL);
      const games = (p?.events || []).map(serializeNbaFromEspn);
      if (games.length) result = { games };
    } catch { /* no data */ }
  }
  if (!result?.games?.length) return { games: [], upcoming: [], warning: null };
  return {
    games: result.games,
    upcoming: result.games
      .filter(g => inNext12h(parseDate(g.startTime)))
      .sort((a, b) => (parseDate(a.startTime) || Infinity) - (parseDate(b.startTime) || Infinity)),
    warning: null
  };
}
'@

Patch 'CS2: expanded source list' @'
// === CS2 - ordered by reliability ===
const CS_SOURCES = [
  'https://hltv-api-rust.vercel.app/api/matches',
  'https://hltv-api-py.vercel.app/api/matches',
  'https://hltv-api-steel.vercel.app/api/matches',
  'https://hltv-api.vercel.app/api/matches.json',
];
'@ @'
// === CS2 - ordered by reliability, more mirrors added ===
const CS_SOURCES = [
  'https://hltv-api-rust.vercel.app/api/matches',
  'https://hltv-api-py.vercel.app/api/matches',
  'https://hltv-api-xi.vercel.app/api/matches',
  'https://hltv-api-steel.vercel.app/api/matches',
  'https://hltv-api.vercel.app/api/matches.json',
  'https://hltv-free.vercel.app/api/matches',
  'https://hltv.orion-alpha.com/api/matches',
];
'@


Patch 'CS2: getCsDataFromBo3 + HTML scrape' @'
// bo3.gg JSON API - fallback when HLTV mirrors are all down
async function getCsDataFromBo3() {
  const all  = [];
  const urls = [
    'https://api.bo3.gg/api/v1/matches?filter[status]=live',
    'https://api.bo3.gg/api/v1/matches?filter[status]=upcoming&page[size]=20',
    'https://bo3.gg/api/v1/matches?filter[status]=live',
    'https://bo3.gg/api/v1/matches?filter[status]=upcoming&page[size]=20',
  ];
'@ @'
// bo3.gg – tries JSON API then falls back to HTML scrape
async function getCsDataFromBo3() {
  const all  = [];
  const urls = [
    'https://bo3.gg/api/v1/matches?filter%5Bstatus%5D%5B%5D=live&filter%5Bstatus%5D%5B%5D=upcoming',
    'https://api.bo3.gg/api/v1/matches?filter%5Bstatus%5D%5B%5D=live&filter%5Bstatus%5D%5B%5D=upcoming',
    'https://bo3.gg/api/v1/matches?filter[status][]=live&filter[status][]=upcoming&page[size]=20',
    'https://api.bo3.gg/api/v1/matches?filter[status][]=live&filter[status][]=upcoming&page[size]=20',
  ];
'@


Patch 'CS2: PandaScore with longer timeout' @'
// PandaScore free public endpoint - last resort CS2 fallback
async function getCsDataFromPanda() {
  const all = [];
  try {
    const [liveData, upData] = await Promise.all([
      fetchJson('https://api.pandascore.co/csgo/matches/running?page[size]=20'),
      fetchJson('https://api.pandascore.co/csgo/matches/upcoming?page[size]=20&sort=begin_at'),
    ]);
'@ @'
// PandaScore free public endpoint - last resort CS2 fallback
async function getCsDataFromPanda() {
  const all = [];
  try {
    // Use 10 s timeout for these slower free-tier endpoints
    const { controller: c1, cleanup: cl1 } = withTimeout(10000);
    const { controller: c2, cleanup: cl2 } = withTimeout(10000);
    const [liveData, upData] = await Promise.all([
      fetch('https://api.pandascore.co/csgo/matches/running?page[size]=20',  { cache:'no-store', signal:c1.signal }).then(r=>r.json()).finally(cl1),
      fetch('https://api.pandascore.co/csgo/matches/upcoming?page[size]=20&sort=begin_at', { cache:'no-store', signal:c2.signal }).then(r=>r.json()).finally(cl2),
    ]);
'@


[System.IO.File]::WriteAllText((Resolve-Path $file), $src, [System.Text.Encoding]::UTF8)
Write-Host "`nDone. Backup: $file.bak" -ForegroundColor Cyan
Write-Host 'Clear cache + restart:  Remove-Item -Recurse -Force .next ; npm run dev' -ForegroundColor Yellow






















