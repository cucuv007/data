const auth = require('./_auth');

const PATH_RE = /^\/rest\/v1\/Tespit(\?[A-Za-z0-9_=&.%:*,()+!~'-]{0,600})?$/;
const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const COLUMNS = ['kurul', 'plaka', 'tarih', 'driver', 'not', 'htt', 'fatura', 'durum', 'member'];

function cleanBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const out = {};
  for (const k of COLUMNS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'durum' || k === 'member') out[k] = v === true || v === 'true';
    else if (v === null || typeof v === 'string') out[k] = v === null ? null : v.slice(0, 20000);
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (!auth.requireUser(req, res, 'POST')) return;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return auth.send(res, 500, { error: 'Sunucu yapılandırması eksik.' });

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  const { path, method = 'GET', body = null } = payload || {};

  if (typeof path !== 'string' || !PATH_RE.test(path) || path.includes('..')) {
    return auth.send(res, 403, { error: 'İzin verilmeyen istek.' });
  }
  if (!METHODS.has(method)) return auth.send(res, 403, { error: 'İzin verilmeyen istek.' });
  if ((method === 'PATCH' || method === 'DELETE') && !/[?&][A-Za-z_]+=eq\./.test(path)) {
    return auth.send(res, 403, { error: 'Filtresiz değişiklik yapılamaz.' });
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const opts = { method, headers, signal: AbortSignal.timeout(20000) };
  if (method === 'POST' || method === 'PATCH') {
    const data = cleanBody(body);
    if (!data || !Object.keys(data).length) return auth.send(res, 400, { error: 'Geçersiz veri.' });
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    opts.body = JSON.stringify(data);
  }

  try {
    const r = await fetch(`${url}${path}`, opts);
    const text = await r.text();
    if (!r.ok) {
      console.error('db upstream', r.status, text.slice(0, 300));
      const duplicate = r.status === 409;
      return auth.send(res, duplicate ? 409 : 502, {
        error: duplicate ? 'Bu kayıt zaten mevcut.' : 'Veritabanı isteği başarısız.'
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(text ? JSON.parse(text) : null);
  } catch (e) {
    console.error('db error', e && e.message);
    return auth.send(res, 500, { error: 'İstek işlenemedi.' });
  }
};
