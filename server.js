/* ==========================================================================
   Fixline server  (Node.js + Express + SQLite)
   --------------------------------------------------------------------------
   Job of this file:
     1. Open the database and create the tables.
     2. Handle accounts: register, log in, log out, and "who am I?".
     3. Expose a JSON API (/api/...) that the browser pages call.
     4. Enforce WHO may do WHAT (residents / staff / manager).
     5. Serve the HTML, CSS and JS files from the /public folder.
   ========================================================================== */
const express = require('express');
const { DatabaseSync } = require('node:sqlite');   // SQLite is built into Node 22+, nothing extra to install
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------- 1. Settings (read from environment variables) ----------
   NO passwords or secrets are written in this file. They come from a local
   ".env" file (never uploaded to GitHub) or from your hosting dashboard.
   If one is missing we generate a random one and print it in the terminal. */
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'fixline.db');
const IS_PROD = process.env.NODE_ENV === 'production';
const rand = () => crypto.randomBytes(12).toString('base64url');
const SECRET = process.env.SESSION_SECRET || rand();                        // signs login cookies
if (!process.env.SESSION_SECRET) console.warn('NOTE: no SESSION_SECRET set. Using a random one, so everyone is logged out when the server restarts.');
const MANAGER_EMAIL = (process.env.MANAGER_EMAIL || 'manager@fixline.local').toLowerCase();
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || rand();
const SEED_DEMO = process.env.SEED_DEMO === 'true';                         // demo accounts + sample issues (off by default)
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || rand();

/* Allowed values: the server re-checks everything the browser sends. */
const STATUSES = ['New', 'Acknowledged', 'Assigned', 'In progress', 'Resolved'];
const LOC = ['Block A', 'Block B', 'Block C', 'Lift / lobby', 'Parking', 'Garden / clubhouse', 'Other'];
const CAT = ['Plumbing / leak', 'Electrical', 'Lift', 'Security', 'Cleaning', 'Other'];
const PRI = ['urgent', 'normal', 'low'];

/* ---------- 2. Database ---------- */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');   // faster, safer writes
db.exec('PRAGMA foreign_keys = ON');    // make REFERENCES actually enforced
// db.transaction(fn): run fn as ONE all-or-nothing unit (if anything fails, nothing is saved).
db.transaction = fn => (...args) => {
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

// The first version of this project had no user accounts. If we find that old
// layout, drop its (demo-only) tables so the new layout can be created.
const oldTickets = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'").get();
if (oldTickets && !db.prepare("PRAGMA table_info(tickets)").all().some(c => c.name === 'owner_id')) {
  console.log('Old database layout found: resetting tickets (demo data only).');
  db.exec('DROP TABLE IF EXISTS history; DROP TABLE tickets;');
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  email    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  flat     TEXT NOT NULL DEFAULT '',
  role     TEXT NOT NULL CHECK (role IN ('resident','staff','manager')),
  salt     TEXT NOT NULL,
  hash     TEXT NOT NULL,           -- we never store the real password
  created  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  loc         TEXT NOT NULL,
  cat         TEXT NOT NULL,
  pri         TEXT NOT NULL,
  n           INTEGER NOT NULL DEFAULT 1,        -- how many residents reported it
  status      TEXT NOT NULL DEFAULT 'New',
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- assigned staff
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- who first reported
  eta         TEXT NOT NULL DEFAULT '',          -- expected fix date YYYY-MM-DD
  t           INTEGER NOT NULL,                  -- created time (ms)
  img         TEXT NOT NULL DEFAULT '',
  rate        INTEGER
);
-- which residents are affected by / follow which ticket (reporter + "add me")
CREATE TABLE IF NOT EXISTS ticket_members (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);
CREATE TABLE IF NOT EXISTS history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hist ON history(ticket_id);
`);

/* ---------- 3. Passwords + users ---------- */
// scrypt is a slow, salted hash: even if the database leaks, passwords stay safe.
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function createUser({ name, email, flat = '', role, password }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO users (name,email,flat,role,salt,hash,created) VALUES (?,?,?,?,?,?,?)')
    .run(name, email.toLowerCase(), flat, role, salt, hashPw(password, salt), Date.now());
  return Number(r.lastInsertRowid);
}
function checkPassword(user, password) {
  const a = Buffer.from(hashPw(String(password), user.salt), 'hex'), b = Buffer.from(user.hash, 'hex');
  return crypto.timingSafeEqual(a, b);
}
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, flat: u.flat, role: u.role });
const userByEmail = e => db.prepare('SELECT * FROM users WHERE email = ?').get(String(e || '').toLowerCase());

// Make sure at least one manager exists (otherwise nobody could create staff).
if (!db.prepare("SELECT 1 FROM users WHERE role='manager'").get()) {
  createUser({ name: 'Society Manager', email: MANAGER_EMAIL, role: 'manager', password: MANAGER_PASSWORD });
  console.log(`Created manager account: ${MANAGER_EMAIL}`);
  if (!process.env.MANAGER_PASSWORD) console.log(`Generated manager password (shown once): ${MANAGER_PASSWORD}`);
}

/* ---------- 4. Demo data ---------- */
function ensureDemoUser(name, email, role, password, flat = '') {
  const u = userByEmail(email);
  return u ? u.id : createUser({ name, email, role, password, flat });
}
function seedDemo() {
  if (!process.env.DEMO_PASSWORD && !userByEmail('aarav@fixline.demo')) console.log(`Generated demo password for the demo accounts (shown once): ${DEMO_PASSWORD}`);
  const ramesh = ensureDemoUser('Ramesh (plumber)', 'ramesh@fixline.demo', 'staff', DEMO_PASSWORD);
  const suresh = ensureDemoUser('Suresh (electrician)', 'suresh@fixline.demo', 'staff', DEMO_PASSWORD);
  const aarav = ensureDemoUser('Aarav Mehta', 'aarav@fixline.demo', 'resident', DEMO_PASSWORD, 'A-204');
  const h = 36e5, n = Date.now(), day = d => new Date(n + d * 864e5).toISOString().slice(0, 10);
  const rows = [
    ['Bathroom leak from ceiling', 'Block A', 'Plumbing / leak', 'urgent', 2, 'In progress', ramesh, day(1), n - 30 * h, [['New', n - 30 * h], ['Acknowledged', n - 28 * h], ['Assigned', n - 26 * h], ['In progress', n - 3 * h]]],
    ['Lift 2 stops at every floor', 'Lift / lobby', 'Lift', 'normal', 1, 'New', null, '', n - 40 * h, [['New', n - 40 * h]]],
    ['Garden light not working', 'Garden / clubhouse', 'Electrical', 'low', 1, 'Resolved', suresh, '', n - 100 * h, [['New', n - 100 * h], ['Assigned', n - 90 * h], ['Resolved', n - 20 * h]]],
  ];
  const insT = db.prepare('INSERT INTO tickets (title,loc,cat,pri,n,status,owner_id,reporter_id,eta,t) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const insH = db.prepare('INSERT INTO history (ticket_id,label,at) VALUES (?,?,?)');
  const insM = db.prepare('INSERT OR IGNORE INTO ticket_members (ticket_id,user_id) VALUES (?,?)');
  db.transaction(() => {
    for (const r of rows) {
      const id = Number(insT.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], aarav, r[7], r[8]).lastInsertRowid);
      r[9].forEach(x => insH.run(id, x[0], x[1]));
      insM.run(id, aarav);
    }
  })();
}
if (SEED_DEMO && db.prepare('SELECT COUNT(*) c FROM tickets').get().c === 0) seedDemo();

/* ---------- 5. Ticket helpers ---------- */
const TICKET_SQL = `SELECT t.*, o.name AS owner, r.name AS reporter, r.flat AS reporter_flat
  FROM tickets t LEFT JOIN users o ON o.id = t.owner_id LEFT JOIN users r ON r.id = t.reporter_id`;
const histOf = db.prepare('SELECT label, at FROM history WHERE ticket_id = ? ORDER BY at, id');
const isMember = db.prepare('SELECT 1 FROM ticket_members WHERE ticket_id = ? AND user_id = ?');

// Turn a database row into what THIS viewer is allowed to see.
function shape(row, viewer) {
  const mine = viewer.role === 'resident' && !!isMember.get(row.id, viewer.id);
  const out = {
    id: row.id, title: row.title, loc: row.loc, cat: row.cat, pri: row.pri, n: row.n,
    status: row.status, owner: row.owner || '', owner_id: row.owner_id, eta: row.eta, t: row.t,
    rate: row.rate, mine,
    img: (viewer.role !== 'resident' || mine) ? row.img : '',   // privacy: others' photos hidden
    hist: histOf.all(row.id).map(h => [h.label, h.at]),
  };
  if (viewer.role !== 'resident') { out.reporter = row.reporter || ''; out.reporter_flat = row.reporter_flat || ''; }
  return out;
}
const getTicket = (id, viewer) => { const r = db.prepare(TICKET_SQL + ' WHERE t.id = ?').get(id); return r && shape(r, viewer); };
function listFor(viewer) {
  const rows = viewer.role === 'staff'
    ? db.prepare(TICKET_SQL + ' WHERE t.owner_id = ? ORDER BY t.t DESC').all(viewer.id)   // staff: only own jobs
    : db.prepare(TICKET_SQL + ' ORDER BY t.t DESC').all();
  return rows.map(r => shape(r, viewer));
}
const addHist = (id, label) => db.prepare('INSERT INTO history (ticket_id,label,at) VALUES (?,?,?)').run(id, label, Date.now());

/* ---------- 6. Login sessions (signed cookie, no extra library) ---------- */
// The cookie holds {uid, exp} plus an HMAC signature. Nobody can edit it
// without knowing SECRET, so we can trust it.
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = uid => { const b = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 12 * 36e5 })).toString('base64url'); return b + '.' + sign(b); };
function readToken(tok) {
  if (!tok) return null;
  const [b, sig] = tok.split('.');
  if (!b || !sig) return null;
  const x = Buffer.from(sig), y = Buffer.from(sign(b));
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, v.join('=')]));
function setSession(res, uid) {
  res.setHeader('Set-Cookie', `fixline_session=${makeToken(uid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${IS_PROD ? '; Secure' : ''}`);
}

// Runs before every request: figure out who is calling (req.user) or null.
function attachUser(req, res, next) {
  const s = readToken(parseCookies(req).fixline_session);
  req.user = s ? (db.prepare('SELECT * FROM users WHERE id = ?').get(s.uid) || null) : null;   // re-check in DB
  next();
}
// Route guard: only let these roles through.
const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Your account type cannot do this' });
  next();
};

// Tiny rate limiter to slow down password guessing and spam.
const hits = new Map();
const limit = (max, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), arr = (hits.get(k) || []).filter(t => now - t < ms);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
  arr.push(now); hits.set(k, arr); next();
};
setInterval(() => hits.clear(), 36e5).unref();

/* ---------- 7. The app and its routes ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {   // basic browser security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ----- public ----- */
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json({ demo: SEED_DEMO }));
app.get('/api/stats', (req, res) => {   // numbers for the home page, no personal data
  const q = sql => db.prepare(sql).get().c;
  res.json({
    open: q("SELECT COUNT(*) c FROM tickets WHERE status != 'Resolved'"),
    resolved: q("SELECT COUNT(*) c FROM tickets WHERE status = 'Resolved'"),
    owned: q("SELECT COUNT(*) c FROM tickets WHERE status != 'Resolved' AND owner_id IS NOT NULL"),
  });
});

/* ----- accounts ----- */
app.post('/api/register', limit(8, 6e4), (req, res) => {   // residents register themselves
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), flat = str(req.body.flat, 20), pw = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email' });
  if (!flat) return res.status(400).json({ error: 'Please enter your flat number' });
  if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (userByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const id = createUser({ name, email, flat, role: 'resident', password: pw });
  setSession(res, id);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});
app.post('/api/login', limit(10, 6e4), (req, res) => {     // everyone logs in here
  const u = userByEmail(req.body.email);
  if (!u || !checkPassword(u, req.body.password || '')) return res.status(401).json({ error: 'Wrong email or password' });
  setSession(res, u.id);
  res.json({ user: publicUser(u) });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'fixline_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

/* ----- tickets: everyone logged in ----- */
app.get('/api/tickets', need('resident', 'staff', 'manager'), (req, res) => res.json(listFor(req.user)));

/* ----- tickets: residents ----- */
app.post('/api/tickets', need('resident'), limit(10, 6e4), (req, res) => {
  const { loc, cat, pri, img } = req.body || {}, title = str(req.body.title, 140);
  if (!title) return res.status(400).json({ error: 'Please describe the problem' });
  if (!LOC.includes(loc) || !CAT.includes(cat) || !PRI.includes(pri)) return res.status(400).json({ error: 'Invalid location, category or priority' });
  if (img && (typeof img !== 'string' || !/^data:image\/jpeg;base64,/.test(img) || img.length > 700000)) return res.status(400).json({ error: 'Photo must be a smaller JPEG' });
  const now = Date.now();
  const id = db.transaction(() => {
    const nid = Number(db.prepare('INSERT INTO tickets (title,loc,cat,pri,t,img,reporter_id) VALUES (?,?,?,?,?,?,?)').run(title, loc, cat, pri, now, img || '', req.user.id).lastInsertRowid);
    db.prepare('INSERT INTO ticket_members (ticket_id,user_id) VALUES (?,?)').run(nid, req.user.id);
    db.prepare('INSERT INTO history (ticket_id,label,at) VALUES (?,?,?)').run(nid, 'New', now);
    return nid;
  })();
  res.status(201).json(getTicket(id, req.user));
});
app.post('/api/tickets/:id/join', need('resident'), limit(20, 6e4), (req, res) => {   // "add me to this issue"
  const t = getTicket(+req.params.id, req.user);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.mine) return res.status(409).json({ error: 'You already follow this issue' });
  db.transaction(() => {
    db.prepare('INSERT INTO ticket_members (ticket_id,user_id) VALUES (?,?)').run(t.id, req.user.id);
    db.prepare('UPDATE tickets SET n = n + 1 WHERE id = ?').run(t.id);
    addHist(t.id, 'Another resident reported this');
  })();
  res.json(getTicket(t.id, req.user));
});
app.post('/api/tickets/:id/rate', need('resident'), (req, res) => {
  const t = getTicket(+req.params.id, req.user), r = Math.round(Number(req.body.rate));
  if (!t || !t.mine) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'Resolved') return res.status(400).json({ error: 'Only resolved issues can be rated' });
  if (t.rate) return res.status(400).json({ error: 'Already rated' });
  if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: 'Rating must be 1 to 5' });
  db.prepare('UPDATE tickets SET rate = ? WHERE id = ?').run(r, t.id);
  res.json(getTicket(t.id, req.user));
});

/* ----- tickets: staff and manager ----- */
app.post('/api/tickets/:id/status', need('staff', 'manager'), (req, res) => {
  const t = getTicket(+req.params.id, req.user), s = req.body.status;
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'staff') {
    if (t.owner_id !== req.user.id) return res.status(403).json({ error: 'This job is not assigned to you' });
    if (!['In progress', 'Resolved'].includes(s)) return res.status(403).json({ error: 'Staff can only start or resolve jobs' });
  }
  if (!STATUSES.includes(s)) return res.status(400).json({ error: 'Invalid status' });
  if (s !== t.status) db.transaction(() => { db.prepare('UPDATE tickets SET status = ? WHERE id = ?').run(s, t.id); addHist(t.id, s); })();
  res.json(getTicket(t.id, req.user));
});

/* ----- manager only ----- */
app.patch('/api/tickets/:id', need('manager'), (req, res) => {
  const t = getTicket(+req.params.id, req.user);
  if (!t) return res.status(404).json({ error: 'Not found' });
  let { status, owner_id, eta } = req.body || {};
  status = status === undefined ? t.status : status;
  owner_id = owner_id === undefined ? t.owner_id : (owner_id ? +owner_id : null);
  eta = eta === undefined ? t.eta : eta;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (eta && !/^\d{4}-\d{2}-\d{2}$/.test(eta)) return res.status(400).json({ error: 'Invalid date' });
  if (owner_id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'staff'").get(owner_id)) return res.status(400).json({ error: 'Owner must be a staff member' });
  // Convenience: giving a new ticket an owner moves it to "Assigned".
  if (owner_id && owner_id !== t.owner_id && status === t.status && ['New', 'Acknowledged'].includes(status)) status = 'Assigned';
  db.transaction(() => {
    db.prepare('UPDATE tickets SET owner_id = ?, eta = ?, status = ? WHERE id = ?').run(owner_id, eta || '', status, t.id);
    if (status !== t.status) addHist(t.id, status);
    else if (owner_id !== t.owner_id) addHist(t.id, owner_id ? 'Owner assigned' : 'Owner removed');
  })();
  res.json(getTicket(t.id, req.user));
});
app.get('/api/staff', need('manager'), (req, res) => {
  res.json(db.prepare("SELECT id, name, email FROM users WHERE role = 'staff' ORDER BY name").all());
});
app.post('/api/staff', need('manager'), limit(20, 6e4), (req, res) => {   // only managers can create staff accounts
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Please enter a name' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email' });
  if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (userByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const id = createUser({ name, email, role: 'staff', password: pw });
  res.status(201).json({ id, name, email });
});
app.delete('/api/staff/:id', need('manager'), (req, res) => {
  const r = db.prepare("DELETE FROM users WHERE id = ? AND role = 'staff'").run(+req.params.id);   // tickets keep, owner becomes empty
  res.json({ deleted: r.changes });
});
app.post('/api/reset', need('manager'), (req, res) => {   // wipe issues and reload demo issues
  db.transaction(() => { db.exec('DELETE FROM history; DELETE FROM ticket_members; DELETE FROM tickets; DELETE FROM sqlite_sequence WHERE name = \'tickets\''); seedDemo(); })();
  res.json({ ok: true });
});

/* ---------- 8. Static files + errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

app.listen(PORT, () => console.log(`Fixline running on http://localhost:${PORT}`));
