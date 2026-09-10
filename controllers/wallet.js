const db = require('../config/db');
const { sanitize } = require('../middleware/security');

exports.page = (req, res) => {
  const transactions = db.getUserTransactions(req.user.id, 30);
  res.render('user/dompet', {
    title: 'Dompet — Lakonan',
    user: req.user,
    transactions,
    error: null,
    success: null,
  });
};

exports.deposit = (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!amount || amount < 1000) {
    const txns = db.getUserTransactions(req.user.id, 30);
    return res.render('user/dompet', { title: 'Dompet — Lakonan', user: req.user, transactions: txns, error: 'Minimal deposit Rp1.000', success: null });
  }
  try {
    // ACID: saldo + transaksi dibuat atomik
    db.creditUser(req.user.id, amount, 'deposit', 'Top up saldo');
  } catch (err) {
    const txns = db.getUserTransactions(req.user.id, 30);
    return res.render('user/dompet', { title: 'Dompet — Lakonan', user: req.user, transactions: txns, error: err.message, success: null });
  }
  const txns = db.getUserTransactions(req.user.id, 30);
  res.render('user/dompet', { title: 'Dompet — Lakonan', user: req.user, transactions: txns, error: null, success: 'Top up berhasil! Saldo bertambah Rp' + amount.toLocaleString('id-ID') });
};

exports.withdraw = (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!amount || amount < 10000) {
    const txns = db.getUserTransactions(req.user.id, 30);
    return res.render('user/dompet', { title: 'Dompet — Lakonan', user: req.user, transactions: txns, error: 'Minimal withdrawal Rp10.000', success: null });
  }
  try {
    // ACID: saldo + transaksi atomik
    db.debitUser(req.user.id, amount, 'withdrawal', 'Tarik saldo');
  } catch (err) {
    const txns = db.getUserTransactions(req.user.id, 30);
    return res.render('user/dompet', { title: 'Dompet — Lakonan', user: req.user, transactions: txns, error: err.message, success: null });
  }
  const reqUser = db.findUserById(req.user.id);
  const txns = db.getUserTransactions(req.user.id, 30);
  res.render('user/dompet', { title: 'Dompet — Lakonan', user: req.user, transactions: txns, error: null, success: 'Penarikan Rp' + amount.toLocaleString('id-ID') + ' berhasil!' });
};
