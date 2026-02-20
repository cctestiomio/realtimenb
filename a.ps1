<#
.SYNOPSIS
    Automated Remediation Script for Esports Dashboard UI (DOM Manipulation)

.DESCRIPTION
    This script parses a target HTML, PHP, or JSX component file. It performs a targeted regex 
    substitution to actively remove rogue 'onclick' navigation handlers pointing to Twitch, 
    and subsequently extracts and relocates the entire Stats Scoreboard DOM component 
    to reside semantically between the Active Games and Upcoming Games containers.

.NOTES
    Ensure the $FilePath variable accurately points to the target source code file.
    Always implement version control backups of the source file prior to execution.
#>

# Define the absolute or relative target file path (Update this to point to the actual UI file)
$FilePath = ".\dashboard_view.html"

# Verify file existence before proceeding to prevent null reference exceptions and pipeline failures
if (-Not (Test-Path $FilePath)) {
    Write-Error "CRITICAL: Target file not found at path: $FilePath. Execution aborted."
    exit
}

# 1. Ingest the file content as a single multiline string utilizing the -Raw parameter
$Content = Get-Content -Path $FilePath -Raw

# =====================================================================
# PHASE 1: Eradicate Rogue Navigation Handlers
# =====================================================================

# FIX: Escaped the single quotes inside the character classes -> [^"'']
$TwitchClickPattern = '(?i)\s*onclick\s*=\s*["''][^"'']*twitch\.tv[^"'']*["'']'
$Content = $Content -replace $TwitchClickPattern, ''

# FIX: Escaped the single quotes here as well
$TwitchHrefPattern = '(?i)\s*href\s*=\s*["''][^"'']*twitch\.tv[^"'']*["'']'
$Content = $Content -replace $TwitchHrefPattern, ''

Write-Output "Phase 1 Complete: Eradicated rogue Twitch navigation handlers."

# =====================================================================
# PHASE 2: Relocate the Stats Scoreboard Component
# =====================================================================
# The objective is to move <div id="stats-scoreboard"> to sit immediately
# after the <div id="active-games"> block and before the <div id="upcoming-games"> block.

# Step 2A: Extract the entire Stats Scoreboard node into system memory.
$ScoreboardRegex = '(?s)(<div\s+id=["'']stats-scoreboard["''].*?</div>\s*)'

if ($Content -match $ScoreboardRegex) {
    # FIX: Isolated the matched HTML block string (Capture Group 1) instead of the whole HashTable
    $ScoreboardHTML = $Matches[1]
    
    # Step 2B: Excise the scoreboard block entirely from its original, incorrect location.
    $Content = $Content -replace $ScoreboardRegex, ''
    
    # Step 2C: Locate the Active Games container and inject the Scoreboard immediately after it.
    $ActiveGamesRegex = '(?s)(<div\s+id=["'']active-games["''].*?</div>\s*)'
    
    # The replacement string injects the original Active Games block ($1) followed immediately by the Scoreboard string.
    $Content = $Content -replace $ActiveGamesRegex, "`$1`n$ScoreboardHTML"
    
    Write-Output "Phase 2 Complete: Successfully extracted and relocated the Stats Scoreboard component."
} else {
    Write-Warning "Phase 2 Failed: Stats Scoreboard component ID not found or regex match failed. Skipping DOM relocation."
}

# =====================================================================
# PHASE 3: Write Output to Disk
# =====================================================================
# Pipe the heavily modified multiline string back to the file system, overwriting the original file.
$Content | Set-Content -Path $FilePath -NoNewline

Write-Output "Remediation script execution successfully completed. Please review the modified file."