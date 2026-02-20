# Realtime Sports Tracker

A fast realtime scoreboard site where you can type or click games to track live updates.

## Vercel/API reliability update

This app uses short HTTP polling (`/api/track`) for live updates (Vercel-friendly), and now includes **multi-source + fallback data mode**:

- NBA tries NBA CDN first, then ESPN fallback.
- LoL / CS / VALORANT use their live APIs, then fallback demo matches if upstream fails.
- The UI shows a warning when fallback mode is active instead of appearing broken.
## Vercel compatibility fix

This app now uses **HTTP polling** (`/api/track`) for live updates instead of relying on long-lived SSE streams. This is more reliable on Vercel serverless deployments.

## Supported sections

- NBA live games + upcoming games in next 12 hours.
- League of Legends esports matches + upcoming in next 12 hours.
- CS2/CSGO esports matches + upcoming in next 12 hours.
- VALORANT esports matches + upcoming in next 12 hours.

## Features

- Polling-based updates optimized for serverless hosts.
- Fast polling-based updates optimized for serverless hosts.
>>>>>>> main
- Light mode by default with a dark-mode toggle.
- Clickable match chips so you can track instantly.
- Manual text query also supported.

## Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## API routes

- `GET /api/games?sport=nba|lol|csgo|valorant` — list and upcoming matches (`warning` included when fallback is active).
- `GET /api/track?sport=nba|lol|csgo|valorant&query=<text>` — current tracked match snapshot.
- `GET /api/games?sport=nba|lol|csgo|valorant` — list and upcoming matches.
- `GET /api/track?sport=nba|lol|csgo|valorant&query=<text>` — current tracked match snapshot (poll this endpoint).
>>>>>>> main
- `GET /api/stream` — deprecated in this app build.

## Polymarket monitor script

A standalone script is included at `polymarket_monitor.py`.
A standalone script is included at `polymarket_monitor.py` with merge conflicts resolved and duplicate-threshold handling fixed.
>>>>>>> main

Run:

```bash
export DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...'
python3 polymarket_monitor.py
```
