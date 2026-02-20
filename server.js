import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveProvider } from './lib/providers.js';
import { getCachedProviderData } from './lib/data-cache.js';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relative).replace(/^\.+/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' });

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/games' || url.pathname === '/api/track') {
    const sport = String(url.searchParams.get('sport') || 'nba');
    const provider = resolveProvider(sport);
    if (!provider) return sendJson(res, 400, { error: `Unsupported sport "${sport}"` });

    try {
      const data = await getCachedProviderData(sport, () => provider.getData());

      if (url.pathname === '/api/games') {
        return sendJson(res, 200, { games: data.games, upcoming: data.upcoming, warning: data.warning || null });
      }

      const query = String(url.searchParams.get('query') || '').trim();
      if (!query) return sendJson(res, 400, { error: 'Missing query' });

      const match = provider.pick(data, query);
      if (!match) {
        return sendJson(res, 404, {
          error: `No game found for "${query}"`,
          suggestions: data.games.slice(0, 20).map((g) => g.label),
          warning: data.warning || null
        });
      }

      return sendJson(res, 200, { match, warning: data.warning || null });
    } catch (error) {
      return sendJson(res, 502, { error: error.message || 'Upstream error' });
    }
  }

  if (url.pathname === '/api/stream') {
    return sendJson(res, 410, { error: 'SSE stream is disabled. Use /api/track polling endpoint.' });
  }

  await serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Realtime score server listening on http://localhost:${PORT}`);
});
