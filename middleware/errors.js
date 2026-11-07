function notFound(req, res) {
  res.status(404).render('errors/404', { title: 'Page not found' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(status).json({ error: status === 500 ? 'An unexpected error occurred.' : error.message });
  }
  res.status(status).render('errors/500', { title: 'Something went wrong', message: status === 500 ? 'Please try again later.' : error.message });
}

module.exports = { notFound, errorHandler };
