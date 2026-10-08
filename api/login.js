const crypto = require('crypto');
const auth = require('./_auth');

const USERS_TABLE = 'Kullanıcılar';
const MAX_TRIES = 5;
const LOCK_MS = 30000;
const attempts = new Map();

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function checkPassword(input, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const derived = crypto.scryptSync(input, Buffer.from(parts[1], 'hex'), 64);
    const expected = Buffer.from(parts[2], 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  }
  return crypto.timingSafeEqual(sha(input), sha(stored));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return auth.send(res, 405, { error: 'Method not allowed' });
  }
  if (!auth.sameOrigin(req)) return auth.send(res, 403, { error: 'Forbidden' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return auth.send(res, 500, { error: 'Sunucu yapılandırması eksik.' });

  const ip = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.count >= MAX_TRIES && now - entry.last < LOCK_MS) {
    return auth.send(res, 429, { error: 'Çok fazla hatalı deneme. Biraz sonra tekrar deneyin.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const username = body && typeof body.username === 'string' ? body.username.trim().toLocaleLowerCase('tr-TR') : '';
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 100 || password.length > 200) {
    return auth.send(res, 400, { error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  try {
    const r = await fetch(
      `${url}/rest/v1/${encodeURIComponent(USERS_TABLE)}?name=eq.${encodeURIComponent(username)}&select=name,pass&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!r.ok) {
      console.error('login upstream', r.status);
      return auth.send(res, 502, { error: 'Veritabanı bağlantısında sorun oluştu.' });
    }
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const ok = !!row && checkPassword(password, row.pass);
    if (!ok) {
      attempts.set(ip, { count: (entry && now - entry.last < LOCK_MS * 4 ? entry.count : 0) + 1, last: now });
      await sleep(400);
      return auth.send(res, 401, { error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    attempts.delete(ip);
    auth.setSession(res, row.name);
    return auth.send(res, 200, { ok: true });
  } catch (e) {
    console.error('login error', e && e.message);
    return auth.send(res, 500, { error: 'Giriş yapılamadı.' });
  }
};
