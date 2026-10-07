// /api/upload.js
// Storage yükleme: ham dosya gövdesini alır, secret key ile Supabase Storage'a yazar.
const BUCKET = 'evrak_files';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !KEY) {
    res.status(500).json({ error: 'Ortam değişkenleri eksik' });
    return;
  }

  try {
    const name = String(req.query.name || '');
    if (!/^[\w.-]+$/.test(name)) {
      res.status(400).json({ error: 'Geçersiz dosya adı' });
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);

    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': req.headers['content-type'] || 'application/octet-stream'
      },
      body: buf
    });
    const text = await r.text();
    if (!r.ok) {
      res.status(r.status).json({ error: text });
      return;
    }
    res.status(200).json({ url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}` });
  } catch (e) {
    console.error('upload error:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
};

module.exports.config = { api: { bodyParser: false } };
