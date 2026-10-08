const crypto = require('crypto');
const auth = require('./_auth');

const BUCKET = 'evrak_files';
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function matchesMagic(type, buf) {
  const head = buf.subarray(0, 12);
  if (type === 'application/pdf') return head.subarray(0, 4).toString('latin1') === '%PDF';
  if (type === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (type === 'image/png') return head.subarray(1, 4).toString('latin1') === 'PNG';
  if (type === 'image/gif') return head.subarray(0, 3).toString('latin1') === 'GIF';
  if (type === 'image/webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (!auth.requireUser(req, res, 'POST')) return;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return auth.send(res, 500, { error: 'Sunucu yapılandırması eksik.' });

  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return auth.send(res, 415, { error: 'Desteklenmeyen dosya türü.' });

  try {
    const buf = await readBody(req);
    if (!buf) return auth.send(res, 413, { error: 'Dosya çok büyük (en fazla 4 MB).' });
    if (!buf.length || !matchesMagic(type, buf)) return auth.send(res, 400, { error: 'Geçersiz dosya.' });

    const name = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': type },
      body: buf,
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) {
      console.error('upload upstream', r.status, (await r.text()).slice(0, 300));
      return auth.send(res, 502, { error: 'Dosya yüklenemedi.' });
    }
    return auth.send(res, 200, { url: `${url}/storage/v1/object/public/${BUCKET}/${name}` });
  } catch (e) {
    console.error('upload error', e && e.message);
    return auth.send(res, 500, { error: 'Dosya yüklenemedi.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
