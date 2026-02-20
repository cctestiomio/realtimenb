import { resolveProvider } from '../lib/providers.js';

export default async function handler(req, res) {
  const sport = req.query?.sport || 'nba';
  const provider = resolveProvider(sport);
  if (!provider) {
    res.status(400).json({ error: `Unsupported sport "${sport}"` });
    return;
  }

  try {
    const data = await provider.getData();
    res.status(200).json({ games: data.games, upcoming: data.upcoming, warning: data.warning || null });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Upstream error' });
  }
}
