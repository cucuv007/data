// /api/config.js
// Vercel serverless function - Supabase config'ı return et

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Vercel environment variables'dan oku
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || 'https://rcvyytkxcgmydkcicxdz.supabase.co',
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ''
  };

  res.status(200).json(config);
}
