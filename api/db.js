// /api/db.js
// Database proxy - secret key server'da sakla, client'tan erişilmesini engelle

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rcvyytkxcgmydkcicxdz.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_SECRET_KEY) {
  console.error('SUPABASE_SECRET_KEY is not set in Vercel environment variables');
}

async function supabaseReq(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer': 'return=representation'
    }
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${SUPABASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  if (method === 'DELETE' || res.status === 204) return null;
  return await res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { action, path, method = 'GET', body } = req.body || {};

    if (!action) {
      res.status(400).json({ error: 'Missing action' });
      return;
    }

    const result = await supabaseReq(path || `/rest/v1/Tespit`, method, body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Database proxy error:', error);
    res.status(500).json({ error: error.message });
  }
}
