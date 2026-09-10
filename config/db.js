const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || './data/lakonan.db';
let db;

function getDb() {
  if (db) return db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate();
  return db;
}

function migrate() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      balance REAL DEFAULT 0,
      escrow_hold REAL DEFAULT 0,
      total_earned REAL DEFAULT 0,
      bio TEXT DEFAULT '',
      is_banned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lakons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'fun',
      reward REAL NOT NULL DEFAULT 0,
      slots INTEGER NOT NULL DEFAULT 1,
      deadline TEXT,
      attachment TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','in_progress','completed','cancelled','disputed')),
      participant_count INTEGER DEFAULT 0,
      winner_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lakon_id INTEGER NOT NULL REFERENCES lakons(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      note TEXT,
      proof_file TEXT,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal','escrow_hold','escrow_release','refund','reward')),
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      reference_id INTEGER,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lakon_id INTEGER NOT NULL REFERENCES lakons(id),
      claimant_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','refunded')),
      resolution TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_lakons_creator ON lakons(creator_id);
    CREATE INDEX IF NOT EXISTS idx_lakons_status ON lakons(status);
    CREATE INDEX IF NOT EXISTS idx_lakons_category ON lakons(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_lakon ON submissions(lakon_id);
  `);
}

// User helpers
function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}
function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}
function createUser({ email, passwordHash, name, role }) {
  const stmt = getDb().prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)');
  const r = stmt.run(email, passwordHash, name, role || 'user');
  return findUserById(r.lastInsertRowid);
}
function updateUser(id, fields) {
  const allowed = ['name','avatar','bio','balance','escrow_hold','total_earned','is_banned'];
  const sets = []; const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(k + ' = ?'); vals.push(fields[k]); }
  }
  if (!sets.length) return findUserById(id);
  sets.push("updated_at = datetime('now')"); vals.push(id);
  getDb().prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  return findUserById(id);
}

// Lakon helpers
function createLakon({ creatorId, title, description, category, reward, slots, deadline, attachment }) {
  const stmt = getDb().prepare(
    'INSERT INTO lakons (creator_id, title, description, category, reward, slots, deadline, attachment, status) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  const r = stmt.run(creatorId, title, description, category || 'fun', reward, slots || 1, deadline || null, attachment || null, 'published');
  return findLakonById(r.lastInsertRowid);
}

// Atomic: create lakon + hold escrow dalam 1 DB transaction
function createLakonWithEscrow({ creatorId, title, description, category, reward, slots, deadline, attachment }) {
  const d = getDb();
  const txn = d.transaction(() => {
    const user = findUserById(creatorId);
    if (!user) throw new Error('User tidak ditemukan');
    if (user.balance < reward) throw new Error('Saldo tidak mencukupi untuk escrow. Top up dulu di Dompet.');
    const lakon = createLakon({ creatorId, title, description, category, reward, slots, deadline, attachment });
    d.prepare('UPDATE users SET balance = balance - ?, escrow_hold = escrow_hold + ? WHERE id = ?').run(reward, reward, creatorId);
    createTransaction({ userId: creatorId, type: 'escrow_hold', amount: -reward, referenceId: lakon.id, description: 'Dana ditahan escrow' });
    return lakon;
  });
  return txn();
}
function findLakonById(id) {
  const row = getDb().prepare('SELECT l.*, u.name as creator_name, u.avatar as creator_avatar FROM lakons l JOIN users u ON l.creator_id = u.id WHERE l.id = ?').get(id);
  return row || null;
}
function findLakons({ category, search, sort, status, limit = 20, offset = 0 }) {
  let sql = 'SELECT l.*, u.name as creator_name, u.avatar as creator_avatar FROM lakons l JOIN users u ON l.creator_id = u.id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND l.status = ?'; params.push(status); }
  if (category) { sql += ' AND l.category = ?'; params.push(category); }
  if (search) { sql += ' AND (l.title LIKE ? OR l.description LIKE ?)'; params.push('%'+search+'%', '%'+search+'%'); }
  if (sort === 'reward') sql += ' ORDER BY l.reward DESC';
  else if (sort === 'deadline') sql += ' ORDER BY l.deadline ASC';
  else sql += ' ORDER BY l.created_at DESC';
  sql += ' LIMIT ? OFFSET ?'; params.push(limit, offset);
  return getDb().prepare(sql).all(...params);
}
function countLakons({ category }) {
  let sql = 'SELECT COUNT(*) as c FROM lakons WHERE 1=1'; const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  return getDb().prepare(sql).get(...params).c;
}
function updateLakon(id, fields) {
  const allowed = ['title','description','category','reward','slots','deadline','attachment','status','participant_count','winner_id'];
  const sets = []; const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(k + ' = ?'); vals.push(fields[k]); }
  }
  if (!sets.length) return findLakonById(id);
  sets.push("updated_at = datetime('now')"); vals.push(id);
  getDb().prepare('UPDATE lakons SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  return findLakonById(id);
}
function isLakonOwner(lakonId, userId) {
  const l = findLakonById(lakonId);
  return l && l.creator_id === userId;
}

// Submission helpers
function createSubmission({ lakonId, userId, note, proofFile }) {
  const stmt = getDb().prepare('INSERT INTO submissions (lakon_id, user_id, note, proof_file) VALUES (?,?,?,?)');
  const r = stmt.run(lakonId, userId, note || null, proofFile || null);
  return getDb().prepare('SELECT * FROM submissions WHERE id = ?').get(r.lastInsertRowid);
}
function findSubmissions(lakonId) {
  return getDb().prepare('SELECT s.*, u.name as user_name FROM submissions s JOIN users u ON s.user_id = u.id WHERE s.lakon_id = ? ORDER BY s.created_at DESC').all(lakonId);
}
function updateSubmission(id, fields) {
  const allowed = ['status','note'];
  const sets = []; const vals = [];
  for (const k of allowed) { if (fields[k] !== undefined) { sets.push(k + ' = ?'); vals.push(fields[k]); } }
  if (!sets.length) return null;
  vals.push(id);
  getDb().prepare('UPDATE submissions SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  return getDb().prepare('SELECT * FROM submissions WHERE id = ?').get(id);
}

// Transaction helpers
function createTransaction({ userId, type, amount, referenceId, description }) {
  const stmt = getDb().prepare('INSERT INTO transactions (user_id, type, amount, reference_id, description) VALUES (?,?,?,?,?)');
  const r = stmt.run(userId, type, amount, referenceId || null, description || null);
  return getDb().prepare('SELECT * FROM transactions WHERE id = ?').get(r.lastInsertRowid);
}
function getUserTransactions(userId, limit = 30) {
  return getDb().prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}
function getAllTransactions(limit = 50) {
  return getDb().prepare('SELECT t.*, u.name as user_name FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT ?').all(limit);
}

// Escrow: deduct from user balance, hold as escrow
function holdEscrow(userId, lakonId, amount) {
  const d = getDb();
  const txn = d.transaction(() => {
    const user = findUserById(userId);
    if (user.balance < amount) throw new Error('Saldo tidak mencukupi');
    d.prepare('UPDATE users SET balance = balance - ?, escrow_hold = escrow_hold + ? WHERE id = ?').run(amount, amount, userId);
    createTransaction({ userId, type: 'escrow_hold', amount: -amount, referenceId: lakonId, description: 'Dana ditahan escrow' });
    return findUserById(userId);
  });
  return txn();
}

// Release escrow to winner
function releaseEscrow(lakonId, winnerId) {
  const d = getDb();
  const txn = d.transaction(() => {
    // Anti double-payout: hanya sekali per lakon
    const lakon = findLakonById(lakonId);
    if (!lakon) throw new Error('Lakon tidak ditemukan');
    if (lakon.status !== 'in_progress' && lakon.status !== 'published') {
      throw new Error('Lakon sudah selesai/closed, payout ganda dicegah');
    }
    const sub = d.prepare(
      'SELECT id FROM submissions WHERE lakon_id = ? AND user_id = ? AND status = ?'
    ).get(lakonId, winnerId, 'approved');
    if (!sub) throw new Error('Pemenang belum terverifikasi');
    // Escrow di release dari CREATOR (yang bayar di awal), reward ke WINNER
    d.prepare('UPDATE users SET escrow_hold = escrow_hold - ? WHERE id = ?').run(lakon.reward, lakon.creator_id);
    d.prepare('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?').run(lakon.reward, lakon.reward, winnerId);
    createTransaction({ userId: winnerId, type: 'reward', amount: lakon.reward, referenceId: lakonId, description: 'Reward dari escrow' });
    createTransaction({ userId: lakon.creator_id, type: 'escrow_release', amount: 0, referenceId: lakonId, description: 'Escrow dilepas ke pemenang' });
    d.prepare('UPDATE lakons SET status = ?, winner_id = ?, participant_count = participant_count WHERE id = ?').run('completed', winnerId, lakonId);
  });
  txn();
}

// ACID wallet: deposit
function creditUser(userId, amount, type, description, referenceId) {
  const d = getDb();
  const txn = d.transaction(() => {
    if (!amount || amount <= 0) throw new Error('Jumlah tidak valid');
    d.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
    createTransaction({ userId, type, amount, referenceId, description });
  });
  txn();
}

// ACID wallet: withdraw
function debitUser(userId, amount, type, description, referenceId) {
  const d = getDb();
  const txn = d.transaction(() => {
    if (!amount || amount <= 0) throw new Error('Jumlah tidak valid');
    const user = findUserById(userId);
    if (!user || user.balance < amount) throw new Error('Saldo tidak mencukupi');
    d.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, userId);
    createTransaction({ userId, type, amount: -amount, referenceId, description });
  });
  txn();
}

// Refund escrow back to creator
function refundEscrow(lakonId) {
  const d = getDb();
  const txn = d.transaction(() => {
    const lakon = findLakonById(lakonId);
    d.prepare('UPDATE users SET escrow_hold = escrow_hold - ?, balance = balance + ? WHERE id = ?').run(lakon.reward, lakon.reward, lakon.creator_id);
    createTransaction({ userId: lakon.creator_id, type: 'refund', amount: lakon.reward, referenceId: lakonId, description: 'Refund escrow' });
    d.prepare('UPDATE lakons SET status = ? WHERE id = ?').run('cancelled', lakonId);
  });
  txn();
}

// Dispute
function createDispute({ lakonId, claimantId, reason }) {
  const stmt = getDb().prepare('INSERT INTO disputes (lakon_id, claimant_id, reason) VALUES (?,?,?)');
  const r = stmt.run(lakonId, claimantId, reason || null);
  getDb().prepare('UPDATE lakons SET status = ? WHERE id = ?').run('disputed', lakonId);
  return getDb().prepare('SELECT * FROM disputes WHERE id = ?').get(r.lastInsertRowid);
}
function findDisputes(status = null) {
  let sql = 'SELECT d.*, l.title as lakon_title, u.name as claimant_name FROM disputes d JOIN lakons l ON d.lakon_id = l.id JOIN users u ON d.claimant_id = u.id WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.created_at DESC LIMIT 30';
  return getDb().prepare(sql).all(...params);
}

// Stats
function getStats() {
  return getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM lakons WHERE status = 'completed') as completed,
      (SELECT COALESCE(SUM(reward),0) FROM lakons WHERE status = 'completed') as total_reward,
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM lakons WHERE status = 'published') as active_lakons
  `).get();
}

// Init
getDb();

module.exports = {
  getDb, findUserByEmail, findUserById, createUser, updateUser,
  createLakon, createLakonWithEscrow, findLakonById, findLakons, countLakons, updateLakon, isLakonOwner,
  createSubmission, findSubmissions, updateSubmission,
  createTransaction, getUserTransactions, getAllTransactions,
  holdEscrow, releaseEscrow, refundEscrow, creditUser, debitUser,
  createDispute, findDisputes, getStats,
};
