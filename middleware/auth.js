const db = require('../config/db');

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    if (req.xhr || req.headers['accept']?.includes('json')) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
    }
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  const user = db.findUserById(req.session.userId);
  if (!user || user.is_banned) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }
  req.user = user;
  res.locals.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Akses ditolak — hanya admin', user: req.user });
  }
  next();
}

function attachUser(req, res, next) {
  if (req.session?.userId) {
    const u = db.findUserById(req.session.userId);
    req.user = u;
    res.locals.user = u;
  } else {
    req.user = null;
    res.locals.user = null;
  }
  next();
}

module.exports = { requireAuth, requireAdmin, attachUser };
