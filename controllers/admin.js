const db = require('../config/db');

exports.dashboard = (req, res) => {
  const d = db.getDb();
  const stats = db.getStats();
  const users_count = d.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const active_users_7d = d.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')").get().c;
  const transactions = db.getAllTransactions(15);
  const disputes = db.findDisputes('open');
  const total_volume = d.prepare('SELECT COALESCE(SUM(ABS(amount)),0) as v FROM transactions WHERE type != ?').get('escrow_hold').v;
  const escrow_held = d.prepare('SELECT COALESCE(SUM(reward),0) as v FROM lakons WHERE status IN (?,?)').get('published','in_progress').v;
  const total_payouts = d.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='reward'").get().v;
  const total_deposits = d.prepare("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='deposit'").get().v;

  // Breakdown per status
  const lakon_status = d.prepare('SELECT status, COUNT(*) as c FROM lakons GROUP BY status').all();
  // Breakdown per kategori
  const lakon_category = d.prepare('SELECT category, COUNT(*) as c FROM lakons GROUP BY category').all();
  // 7 hari terakhir aktivitas
  const activity_7d = d.prepare(`
    SELECT date(created_at) as day, COUNT(*) as txns FROM transactions
    WHERE created_at >= datetime('now','-7 days') GROUP BY day ORDER BY day
  `).all();

  res.render('admin/dashboard', {
    title: 'Admin — Lakonan',
    user: req.user,
    stats,
    users_count,
    active_users_7d,
    transactions,
    disputes,
    total_volume,
    escrow_held,
    total_payouts,
    total_deposits,
    lakon_status,
    lakon_category,
    activity_7d,
  });
};

exports.resolveDispute = (req, res) => {
  const disputeId = parseInt(req.params.id);
  const { action, resolution } = req.body;
  const dispute = db.getDb().prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId);
  if (!dispute) return res.json({ error: 'Sengketa tidak ditemukan' });

  const d = db.getDb();
  try {
    if (action === 'refund') {
      db.refundEscrow(dispute.lakon_id);
      d.prepare('UPDATE disputes SET status = ?, resolution = ? WHERE id = ?').run('refunded', resolution || 'Refund by admin', disputeId);
    } else {
      d.prepare('UPDATE disputes SET status = ?, resolution = ? WHERE id = ?').run('resolved', resolution || 'Resolved', disputeId);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ error: err.message });
  }
};