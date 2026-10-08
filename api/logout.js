const auth = require('./_auth');

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return auth.send(res, 405, { error: 'Method not allowed' });
  }
  if (!auth.sameOrigin(req)) return auth.send(res, 403, { error: 'Forbidden' });
  auth.clearSession(res);
  return auth.send(res, 200, { ok: true });
};
