const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { sanitize } = require('../middleware/security');

exports.loginPage = (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Masuk — Lakonan', error: null, user: null });
};

exports.loginAction = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('auth/login', { title: 'Masuk — Lakonan', error: 'Email dan password wajib diisi', user: null });
  }
  const user = db.findUserByEmail(sanitize(email.toLowerCase()));
  if (!user) {
    return res.render('auth/login', { title: 'Masuk — Lakonan', error: 'Email tidak ditemukan', user: null });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.render('auth/login', { title: 'Masuk — Lakonan', error: 'Password salah', user: null });
  }
  if (user.is_banned) {
    return res.render('auth/login', { title: 'Masuk — Lakonan', error: 'Akun dibanned', user: null });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  // Session fixation defense: regenerate session id setelah login
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { title: 'Error', message: 'Gagal membuat session', user: null });
    req.session.userId = user.id;
    req.session.role = user.role;
    // Open redirect protection: hanya allow redirect path lokal
    let redirect = req.query.redirect || '/dashboard';
    if (!redirect.startsWith('/') || redirect.startsWith('//')) redirect = '/dashboard';
    res.redirect(redirect);
  });
};

exports.registerPage = (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Daftar — Lakonan', error: null, user: null });
};

exports.registerAction = async (req, res) => {
  const { email, name, password, confirm } = req.body;
  if (!email || !name || !password) {
    return res.render('auth/register', { title: 'Daftar — Lakonan', error: 'Semua field wajib diisi', user: null });
  }
  if (password !== confirm) {
    return res.render('auth/register', { title: 'Daftar — Lakonan', error: 'Password tidak cocok', user: null });
  }
  if (password.length < 8) {
    return res.render('auth/register', { title: 'Daftar — Lakonan', error: 'Password minimal 8 karakter', user: null });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('auth/register', { title: 'Daftar — Lakonan', error: 'Email tidak valid', user: null });
  }
  const existing = db.findUserByEmail(email.toLowerCase());
  if (existing) {
    return res.render('auth/register', { title: 'Daftar — Lakonan', error: 'Email sudah terdaftar', user: null });
  }
  const hash = await bcrypt.hash(password, 12);
  const user = db.createUser({ email: email.toLowerCase(), passwordHash: hash, name: sanitize(name) });
  req.session.userId = user.id;
  res.redirect('/dashboard');
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
};
