# Realtime Sports Tracker

A fast realtime scoreboard site where you can type or click games to track live updates.

## Supported sections

- NBA live games + upcoming games in next 12 hours.
- League of Legends esports matches + upcoming in next 12 hours.
- CS2/CSGO esports matches + upcoming in next 12 hours.
- VALORANT esports matches + upcoming in next 12 hours.

## Features

- 1-second SSE polling stream for low-latency score/status updates.
- Light mode by default with a dark-mode toggle.
- Clickable match chips so you can track instantly.
- Manual text query also supported.

## Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## API routes

- `GET /api/games?sport=nba|lol|csgo|valorant` — list and upcoming matches.
- `GET /api/stream?sport=nba|lol|csgo|valorant&query=<text>` — SSE stream for selected match.
