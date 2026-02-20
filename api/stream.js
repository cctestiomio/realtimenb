export default function handler(_req, res) {
  res.status(410).json({ error: 'SSE stream is disabled. Use /api/track polling endpoint.' });
}
