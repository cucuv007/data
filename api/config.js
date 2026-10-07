// /api/config.js
// Vercel serverless function - environment variables'ı güvenli şekilde return et

export default function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.VERCEL_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Publishable key'i return et (public, güvenli)
  // Secret key'i return ETMEDİK - sadece Vercel'de server-side kullanılır
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY
  });
}
