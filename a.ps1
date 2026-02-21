<#
.SYNOPSIS
    Automated Remediation Script for app.js Polling and Display Issues

.DESCRIPTION
    This script parses public/app.js. It performs regex substitution to:
    1. Increase the tracking poll interval from 1000ms to 5000ms.
    2. Convert overlapping setInterval calls to safe recursive setTimeout promises.
    3. Update the `buildChip` UI function to show actual live clock times for the NBA.
#>

$FilePath = ".\public\app.js"

if (-Not (Test-Path $FilePath)) {
    Write-Error "CRITICAL: Target file not found at path: $FilePath. Execution aborted."
    exit
}

$Content = Get-Content -Path $FilePath -Raw

# =====================================================================
# PHASE 1: Fix Polling Interval & Overlapping Intervals
# =====================================================================

# 1A. Increase tracking poll ms to 5000
$Content = $Content -replace 'const TRACK_POLL_MS\s*=\s*1000;', 'const TRACK_POLL_MS      = 5000;'

# 1B. Fix the clearPolling method to use clearTimeout for pollTimer
$Content = $Content -replace 'clearInterval\(ss\.pollTimer\);', 'clearTimeout(ss.pollTimer);'

# 1C. Convert startTracking from overlapping setInterval to a safe recursive setTimeout
$oldStartTracking = '(?s)fetchTrack\(sportKey, query, false\);\s*ss\.pollTimer = setInterval\(\(\) => fetchTrack\(sportKey, ss\.currentQuery, true\), TRACK_POLL_MS\);\s*}'
$newStartTracking = @'
  const poll = async () => {
    if (ss.currentQuery !== query) return;
    await fetchTrack(sportKey, query, true);
    ss.pollTimer = setTimeout(poll, TRACK_POLL_MS);
  };
  
  fetchTrack(sportKey, query, false).then(() => {
    ss.pollTimer = setTimeout(poll, TRACK_POLL_MS);
  });
}
'@
$Content = $Content -replace $oldStartTracking, $newStartTracking

# =====================================================================
# PHASE 2: Fix NBA Live Display format inside buildChip
# =====================================================================

$oldBuildChip = '(?s)function buildChip\(sportKey, game\).*?return btn;\s*}'
$newBuildChip = @'
function buildChip(sportKey, game) {
  const live = isLiveStatus(game.status);
  const btn  = document.createElement('button');
  btn.type      = 'button';
  btn.className = `game-chip${live ? ' chip-live' : ''}`;
  btn.dataset.label = game.label;

  let content = '';

  if (live) {
     if (sportKey === 'nba') {
         let clockText = (game.clock || '').trim();
         if (clockText.toLowerCase() === 'live') {
             clockText = '';
         }
         if (clockText) {
             content = `${game.label} ${BULLET} ${clockText} ${BULLET} LIVE`;
         } else {
             content = `${game.label} ${BULLET} LIVE`;
         }
     } else {
         const timeStr = game.clock || 'LIVE';
         content = `${game.label} ${BULLET} ${game.status} ${BULLET} ${timeStr}`;
     }
  } else {
     const timeStr = formatPacificTime(game.startTime);
     content = `${game.label} ${BULLET} ${game.status} ${BULLET} ${timeStr}`;
  }

  btn.textContent = content.replace(/\s+/g, ' ').trim();
  btn.addEventListener('click', () => {
    const ss = state.get(sportKey);
    if (ss) ss.input.value = game.label;
    startTracking(sportKey, game.label);
  });
  return btn;
}
'@

$Content = $Content -replace $oldBuildChip, $newBuildChip

# =====================================================================
# PHASE 3: Write Output to Disk
# =====================================================================

$Content | Set-Content -Path $FilePath -NoNewline

Write-Output "Remediation complete. public/app.js has been successfully updated."