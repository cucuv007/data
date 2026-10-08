const auth = require('./_auth');

module.exports = function handler(req, res) {
  const user = auth.requireUser(req, res, 'GET');
  if (!user) return;
  auth.send(res, 200, { user });
};
