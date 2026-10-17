const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch {}
const express = require('express');
require('./db');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});
app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '200kb' }));
app.use(express.json({ limit: '100kb' }));
// CSRF defence: state-changing API calls must be JSON (cross-site forms cannot send that) on top of SameSite cookies
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/payments/webhook') return next();
  if (!req.is('json')) return res.status(415).json({ error: 'JSON required' });
  next();
});
app.use('/api', require('./routes/public'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong' });
});
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Little Riot running on http://localhost:' + (process.env.PORT || 3000)));
module.exports = app;
