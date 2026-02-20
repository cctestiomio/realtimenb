import { resolveProvider } from '../lib/providers.js';
import { getCachedProviderData } from '../lib/data-cache.js';

export default async function handler(req, res) {
  const sport = req.query?.sport || 'nba';
  const query = String(req.query?.query || '').trim();
  const provider = resolveProvider(sport);

  if (!provider) {
    res.status(400).json({ error: `Unsupported sport "${sport}"` });
    return;
  }
  if (!query) {
    res.status(400).json({ error: 'Missing query' });
    return;
  }

  try {
    const data = await getCachedProviderData(sport, () => provider.getData());
    const match = provider.pick(data, query);
    if (!match) {
      res.status(404).json({
        error: `No game found for "${query}"`,
        suggestions: data.games.slice(0, 20).map((g) => g.label),
        warning: data.warning || null
      });
      return;
    }
    res.status(200).json({ match, warning: data.warning || null });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Upstream error' });
  }
}
