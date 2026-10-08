const crypto = require('crypto');

const COOKIE = 'evrak_session';
const TTL_SECONDS = 12 * 3600;

function secret() {
  const base = process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || '';
  if (!base) throw new Error('missing_secret');
  return crypto.createHash('sha256').update('evrak-session:' + base).digest();
}

function sign(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, e: Date.now() + TTL_SECONDS * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const payload = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(crypto.createHmac('sha256', secret()).update(payload).digest('base64url'));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data || typeof data.u !== 'string' || typeof data.e !== 'number' || data.e < Date.now()) return null;
    return data.u;
  } catch (e) {
    return null;
  }
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === COOKIE) return part.slice(idx + 1).trim();
  }
  return '';
}

function currentUser(req) {
  try {
    return verify(readCookie(req));
  } catch (e) {
    return null;
  }
}

function setSession(res, user) {
  res.setHeader('Set-Cookie', `${COOKIE}=${sign(user)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === req.headers.host;
    } catch (e) {
      return false;
    }
  }
  return true;
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function requireUser(req, res, method) {
  if (req.method !== method) {
    res.setHeader('Allow', method);
    send(res, 405, { error: 'Method not allowed' });
    return null;
  }
  if (method !== 'GET' && !sameOrigin(req)) {
    send(res, 403, { error: 'Forbidden' });
    return null;
  }
  const user = currentUser(req);
  if (!user) {
    send(res, 401, { error: 'Oturum gerekli' });
    return null;
  }
  return user;
}

module.exports = { send, setSession, clearSession, currentUser, requireUser, sameOrigin };
