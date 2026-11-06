const crypto = require('crypto');

function attachCsrfToken(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function requireCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token') || req.body?._csrf;
  const expected = req.session.csrfToken || '';
  const valid = typeof supplied === 'string'
    && supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  next();
}

module.exports = { attachCsrfToken, requireCsrf };
