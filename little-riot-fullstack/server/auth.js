const crypto = require('crypto');
const { db } = require('./db');
const hash = pw => { const s = crypto.randomBytes(16); return 's1$' + s.toString('hex') + '$' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const check = (pw, h) => { const [, s, k] = h.split('$'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(k, 'hex')); };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const token = req => (/(?:^|;\s*)lr_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '') || [])[1];
const COOKIE = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
function startSession(res, userId) {
  const t = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(t), userId, Date.now() + 8 * 3600e3);
  res.cookie('lr_sid', t, { ...COOKIE, maxAge: 8 * 3600e3 });
}
function endSession(req, res) { const t = token(req); if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t)); res.clearCookie('lr_sid', COOKIE); }
function currentUser(req) {
  const t = token(req); if (!t) return null;
  return db.prepare('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(sha(t), Date.now()) || null;
}
const need = (...roles) => (req, res, next) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'You do not have permission for this' });
  req.user = u; next();
};
const hits = new Map();
const limit = (max, ms) => (req, res, next) => {
  const k = req.ip + req.baseUrl + req.path, now = Date.now(), h = hits.get(k);
  if (!h || h.reset < now) hits.set(k, { n: 1, reset: now + ms });
  else if (++h.n > max) return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  next();
};
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60e3).unref();
const audit = (u, action, detail) => db.prepare('INSERT INTO audit(user_id,action,detail,at) VALUES(?,?,?,?)').run(u && u.id, action, detail || '', Date.now());
module.exports = { hash, check, startSession, endSession, currentUser, need, limit, audit };
