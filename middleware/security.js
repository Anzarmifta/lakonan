const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

function securityMiddleware(app) {
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Terlalu banyak request. Coba lagi nanti.',
  }));
}

// CSRF: session-based token (transparan, tanpa double-submit cookie)
function generateCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtect(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const expected = req.session?.csrfToken;
  const received = req.body?._csrf || req.headers['x-csrf-token'];
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(received || ''), 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(403).json({ error: 'CSRF token tidak valid' });
  next();
}

// Rate limiter khusus
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.',
});
const walletLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  message: 'Terlalu banyak request finansial. Coba lagi nanti.',
});

// Sanitize: basic XSS guard (trust EJS auto-escaping for output)
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>]/g, '').trim();
}

module.exports = { securityMiddleware, authLimiter, walletLimiter, csrfProtect, generateCsrfToken, sanitize };