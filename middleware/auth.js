function requireUser(req, res, next) {
  if (!req.session.userId) {
    if (req.accepts('html')) return res.redirect('/');
    return res.status(401).json({ error: 'Authenticate with Telegram to continue.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  next();
}

module.exports = { requireUser, requireAdmin };
