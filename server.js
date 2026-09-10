require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { securityMiddleware, authLimiter, walletLimiter, csrfProtect, generateCsrfToken } = require('./middleware/security');
const { attachUser, requireAuth, requireAdmin } = require('./middleware/auth');
const authCtrl = require('./controllers/auth');
const lakonCtrl = require('./controllers/lakon');
const walletCtrl = require('./controllers/wallet');
const adminCtrl = require('./controllers/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Security layer 1
securityMiddleware(app);

// Body parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Cookie parser (dibutuhkan CSRF double-submit cookie pattern)
app.use(cookieParser());

// Session
const dbDir = path.dirname(process.env.DATABASE_PATH || './data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dbDir, table: 'sessions' }),
  secret: process.env.SESSION_SECRET || 'lakonan-v2-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Inject CSRF token ke semua view (untuk fetch header + form hidden)
app.use((req, res, next) => {
  try {
    if (req.session && !req.session.csrfInit) req.session.csrfInit = true;
    res.locals.csrfToken = generateCsrfToken(req);
  } catch (e) {
    res.locals.csrfToken = '';
  }
  next();
});

// Attach user to all views
app.use(attachUser);

// Static & view engine
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// File upload config
const uploadDir = path.join(dbDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf','application/zip'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipe file tidak diizinkan'));
  }
});

// ═══════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════

// Landing
app.get('/', (req, res) => {
  const db = require('./config/db');
  const stats = db.getStats();
  res.render('landing', { title: 'Lakonan — Ada kerjaan. Ada hadiahnya.', user: req.user, stats });
});

// Auth
app.get('/login', authCtrl.loginPage);
app.post('/login', authLimiter, csrfProtect, authCtrl.loginAction);
app.get('/register', authCtrl.registerPage);
app.post('/register', authLimiter, csrfProtect, authCtrl.registerAction);
app.get('/logout', authCtrl.logout);

// User dashboard
app.get('/dashboard', requireAuth, lakonCtrl.dashboard);
app.get('/lakon/new', requireAuth, lakonCtrl.createPage);
app.post('/lakon/new', requireAuth, csrfProtect, upload.single('attachment'), lakonCtrl.createAction);
app.get('/lakon/:id', lakonCtrl.detailPage);
app.post('/api/lakon/:id/submit', requireAuth, csrfProtect, upload.single('proof'), lakonCtrl.submitAction);
app.post('/api/lakon/:id/verify', requireAuth, csrfProtect, lakonCtrl.verifySubmission);
app.post('/api/lakon/:id/dispute', requireAuth, csrfProtect, lakonCtrl.disputeAction);

// Wallet
app.get('/dompet', requireAuth, walletCtrl.page);
app.post('/dompet/deposit', requireAuth, walletLimiter, csrfProtect, walletCtrl.deposit);
app.post('/dompet/withdraw', requireAuth, walletLimiter, csrfProtect, walletCtrl.withdraw);

// Static pages
app.get('/snk', (req, res) => res.render('user/snk', { title: 'Syarat & Ketentuan — Lakonan', user: req.user }));
app.get('/about', (req, res) => res.render('user/about', { title: 'Tentang — Lakonan', user: req.user }));

// Admin
app.get('/admin', requireAuth, requireAdmin, adminCtrl.dashboard);
app.post('/api/admin/dispute/:id', requireAuth, requireAdmin, csrfProtect, adminCtrl.resolveDispute);

// ═══════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════

app.use((req, res) => {
  res.status(404).render('error', { title: '404 — Lakonan', message: 'Halaman tidak ditemukan', user: req.user });
});

app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).render('error', { title: 'Error — Lakonan', message: 'Terjadi kesalahan. Tim kami sudah diberitahu.', user: req.user });
});

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log('LAKONAN v2 — http://localhost:' + PORT);
  console.log('Mode:', process.env.NODE_ENV || 'development');
});

module.exports = app;
