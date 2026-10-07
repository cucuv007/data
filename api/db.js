// /api/db.js
// Database proxy - secret key server'da sakla, client'tan erişilmesini engelle

const ALLOWED_PREFIX = '/rest/v1/Tespit';
const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SECRET_KEY eksik' });
    return;
  }
  try {
    let payload = req.body;
    if (typeof payload === 'string') payload = JSON.parse(payload || '{}');
    const { path, method = 'GET', body = null } = payload || {};
    if (typeof path !== 'string' || !(path === ALLOWED_PREFIX || path.startsWith(ALLOWED_PREFIX + '?'))) {
      res.status(403).json({ error: 'Path izinli değil' });
      return;
    }
    if (!ALLOWED_METHODS.includes(method)) {
      res.status(403).json({ error: 'Method izinli değil' });
      return;
    }
    const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=representation' };
    const opts = { method, headers };
    if (body) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(`${SUPABASE_URL}${path}`, opts);
    const text = await r.text();
    if (!r.ok) {
      res.status(r.status).json({ error: text });
      return;
    }
    res.status(200).json(text ? JSON.parse(text) : null);
  } catch (e) {
    console.error('db proxy error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
