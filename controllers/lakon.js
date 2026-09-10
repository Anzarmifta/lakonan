const db = require('../config/db');
const { sanitize } = require('../middleware/security');

exports.dashboard = (req, res) => {
  const { category, search, sort } = req.query;
  const lakons = db.findLakons({ status: 'published', category: category || null, search: search || null, sort: sort || 'newest', limit: 12 });
  const stats = db.getStats();
  res.render('user/dashboard', {
    title: 'Dashboard — Lakonan',
    user: req.user,
    lakons,
    category: category || '',
    search: search || '',
    sort: sort || 'newest',
    stats,
  });
};

exports.createPage = (req, res) => {
  res.render('user/buat-lakon', { title: 'Buat Lakon — Lakonan', user: req.user, error: null });
};

exports.createAction = (req, res) => {
  const { title, description, category, reward, slots, deadline } = req.body;
  const rewardNum = parseInt(reward);
  const slotsNum = parseInt(slots) || 1;

  if (!title || typeof title !== 'string' || title.trim().length < 5) return res.render('user/buat-lakon', { title: 'Buat Lakon', user: req.user, error: 'Judul minimal 5 karakter' });
  if (!rewardNum || rewardNum < 1000 || rewardNum > 100_000_000) return res.render('user/buat-lakon', { title: 'Buat Lakon', user: req.user, error: 'Reward antara Rp1.000 — Rp100.000.000' });
  if (!slotsNum || slotsNum < 1 || slotsNum > 100) return res.render('user/buat-lakon', { title: 'Buat Lakon', user: req.user, error: 'Slot antara 1 — 100' });

  const attachment = req.file ? req.file.filename : null;

  try {
    // Atomic: escrow hold + create lakon dalam 1 transaksi
    const lakon = db.createLakonWithEscrow({
      creatorId: req.user.id,
      title: sanitize(title),
      description: sanitize(description || ''),
      category: ['fun','digital','fisik'].includes(category) ? category : 'fun',
      reward: rewardNum,
      slots: slotsNum,
      deadline: deadline || null,
      attachment,
    });
    res.redirect('/lakon/' + lakon.id);
  } catch (err) {
    return res.render('user/buat-lakon', { title: 'Buat Lakon', user: req.user, error: err.message });
  }
};

exports.detailPage = (req, res) => {
  const lakon = db.findLakonById(parseInt(req.params.id));
  if (!lakon) return res.status(404).render('error', { title: '404', message: 'Lakon tidak ditemukan', user: req.user });
  const submissions = db.findSubmissions(lakon.id);
  const isOwner = req.user && lakon.creator_id === req.user.id;
  const hasSubmitted = req.user ? submissions.some(s => s.user_id === req.user.id) : false;
  const isFull = lakon.participant_count >= lakon.slots;

  res.render('user/detail-lakon', {
    title: lakon.title + ' — Lakonan',
    user: req.user,
    lakon,
    submissions,
    isOwner,
    hasSubmitted,
    isFull,
  });
};

exports.submitAction = (req, res) => {
  const lakonId = parseInt(req.params.id);
  const lakon = db.findLakonById(lakonId);
  if (!lakon || lakon.status !== 'published') return res.json({ error: 'Lakon tidak tersedia' });
  if (lakon.creator_id === req.user.id) return res.json({ error: 'Tidak bisa submit lakon sendiri' });
  if (lakon.participant_count >= lakon.slots) return res.json({ error: 'Slot sudah penuh' });

  const existing = db.findSubmissions(lakonId).filter(s => s.user_id === req.user.id);
  if (existing.length > 0) return res.json({ error: 'Kamu sudah submit' });

  const proofFile = req.file ? req.file.filename : null;
  const submission = db.createSubmission({ lakonId, userId: req.user.id, note: sanitize(req.body.note || ''), proofFile });
  db.getDb().prepare('UPDATE lakons SET participant_count = participant_count + 1 WHERE id = ?').run(lakonId);
  res.json({ success: true, submission });
};

exports.verifySubmission = (req, res) => {
  const lakon = db.findLakonById(parseInt(req.params.id));
  if (!lakon || lakon.creator_id !== req.user.id) return res.json({ error: 'Bukan pembuat lakon' });

  const { submissionId, action } = req.body; // action: 'approve' | 'reject'
  const submissionIdNum = parseInt(submissionId);
  if (!submissionIdNum) return res.json({ error: 'Submission tidak valid' });

  // Wajib submission milik lakon ini (cegah cross-lakon approve)
  const sub = db.getDb().prepare('SELECT * FROM submissions WHERE id = ? AND lakon_id = ?').get(submissionIdNum, lakon.id);
  if (!sub) return res.json({ error: 'Submission tidak ditemukan di lakon ini' });

  if (action === 'approve') {
    // Cegah double-approve: status sudah approved -> tolak
    if (sub.status === 'approved') return res.json({ error: 'Submission ini sudah disetujui' });
    db.updateSubmission(submissionIdNum, { status: 'approved' });
    try {
      db.releaseEscrow(lakon.id, sub.user_id);
    } catch (err) {
      db.updateSubmission(submissionIdNum, { status: 'submitted' }); // rollback status jika escrow gagal
      return res.json({ error: err.message });
    }
    return res.json({ success: true, message: 'Pemenang dipilih! Dana escrow dicairkan.' });
  } else if (action === 'reject') {
    if (sub.status === 'approved') return res.json({ error: 'Tidak bisa menolak submission yang sudah disetujui' });
    db.updateSubmission(submissionIdNum, { status: 'rejected' });
    return res.json({ success: true, message: 'Submission ditolak' });
  } else {
    return res.json({ error: 'Aksi tidak dikenal' });
  }
};

exports.disputeAction = (req, res) => {
  const lakonId = parseInt(req.params.id);
  db.createDispute({ lakonId, claimantId: req.user.id, reason: req.body.reason });
  res.json({ success: true, message: 'Sengketa dilaporkan. Admin akan meninjau.' });
};
