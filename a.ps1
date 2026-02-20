# ============================================================
# Realtime Sports Patch Installer v5 (FINAL FIXED)
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Realtime Sports patcher starting..." -ForegroundColor Yellow
Write-Host ""

# ------------------------------------------------------------
# Safe file writer
# ------------------------------------------------------------
function Write-FileSafe($path, $content) {

    $dir = Split-Path $path

    # Only create directory if it exists and is not empty
    if ($dir -and $dir.Trim() -ne "" -and !(Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    Set-Content -Path $path -Value $content -Encoding UTF8

    Write-Host ("OK  " + $path) -ForegroundColor Green
}

# ============================================================
# vercel.json
# ============================================================

Write-FileSafe "vercel.json" @'
{
  "functions": {
    "api/**/*.js": {
      "maxDuration": 20
    }
  }
}
'@


# ============================================================
# lib/data-cache.js
# ============================================================

Write-FileSafe "lib/data-cache.js" @'
const cache = new Map();

export function cached(key, ttl, fetcher) {
  const now = Date.now();
  const item = cache.get(key);

  if (item && (now - item.time) < ttl) {
    return item.value;
  }

  const value = fetcher();
  cache.set(key, { value, time: now });

  return value;
}
'@


# ============================================================
# lib/providers.js
# ============================================================

Write-FileSafe "lib/providers.js" @'
export async function fetchJSON(url, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(id);

  if (!res.ok) throw new Error("Network error");

  return await res.json();
}
'@


# ============================================================
# public/index.html
# ============================================================

Write-FileSafe "public/index.html" @'
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Realtime Sports</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1>Live Scores</h1>
  <div id="app"></div>
  <script src="app.js"></script>
</body>
</html>
'@


# ============================================================
# public/styles.css
# ============================================================

Write-FileSafe "public/styles.css" @'
body {
  font-family: Arial, sans-serif;
  background: #111;
  color: white;
  padding: 20px;
}

.card {
  background: #222;
  margin: 10px 0;
  padding: 10px;
  border-radius: 8px;
}
'@


# ============================================================
# public/app.js
# ============================================================

Write-FileSafe "public/app.js" @'
async function load() {
  const el = document.getElementById("app");
  el.innerHTML = "Loading...";

  try {
    const res = await fetch("/api/track?sport=nba");
    const data = await res.json();

    el.innerHTML = "";

    data.forEach(game => {
      const div = document.createElement("div");
      div.className = "card";
      div.textContent = `${game.home} ${game.homeScore} - ${game.awayScore} ${game.away}`;
      el.appendChild(div);
    });

  } catch {
    el.innerHTML = "Failed to load.";
  }
}

setInterval(load, 5000);
load();
'@


# ============================================================
# DONE
# ============================================================

Write-Host ""
Write-Host "DONE - files replaced successfully." -ForegroundColor Cyan
Write-Host ""
Pause