try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')); } catch {}
const { db } = require('./db');
const { hash } = require('./auth');
const [email, pw, role = 'owner'] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Usage: npm run create-admin -- you@example.com "a-long-password" [owner|manager]'); process.exit(1); }
if (!pw || pw.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }
if (!['owner', 'manager'].includes(role)) { console.error('Role must be owner or manager.'); process.exit(1); }
db.prepare('INSERT INTO users(email,pass_hash,role,created_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET pass_hash=excluded.pass_hash, role=excluded.role')
  .run(email.toLowerCase(), hash(pw), role, Date.now());
console.log(`Admin ready: ${email.toLowerCase()} (${role})`);
