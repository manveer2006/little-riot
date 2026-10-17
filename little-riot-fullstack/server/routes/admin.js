const express = require('express');
const { db } = require('../db');
const A = require('../auth');
const S = require('../shop');
const r = express.Router();
const DUMMY = A.hash('dummy-password-for-timing');

r.get('/me', (req, res) => res.json({ user: A.currentUser(req) }));
r.post('/login', A.limit(10, 15 * 60e3), (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase(), pw = String((req.body || {}).password || '');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = A.check(pw, u ? u.pass_hash : DUMMY) && !!u;
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password' });
  A.startSession(res, u.id); A.audit(u, 'login');
  res.json({ user: { id: u.id, email: u.email, role: u.role } });
});
r.post('/logout', (req, res) => { A.endSession(req, res); res.json({ ok: true }); });

r.use(A.need('owner', 'manager'));

r.get('/products', (req, res) => res.json({ products: db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(S.toClient) }));
r.post('/products', (req, res, next) => {
  try {
    const p = S.cleanProduct(req.body || {});
    const id = db.prepare('INSERT INTO products(name,collection,category,price,sale_price,color,stock,sizes,description,active,created_at) VALUES(@name,@collection,@category,@price,@sale_price,@color,@stock,@sizes,@description,@active,@created)').run({ ...p, created: Date.now() }).lastInsertRowid;
    A.audit(req.user, 'product.create', p.name); res.json({ id: Number(id) });
  } catch (e) { next(e); }
});
const patchProduct = (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Product not found' });
    const p = S.cleanProduct({ ...S.toClient(row), ...(req.body || {}) });
    db.prepare('UPDATE products SET name=@name,collection=@collection,category=@category,price=@price,sale_price=@sale_price,color=@color,stock=@stock,sizes=@sizes,description=@description,active=@active WHERE id=@id').run({ ...p, id: row.id });
    if (p.stock !== row.stock) A.audit(req.user, 'stock.change', `${row.name}: ${row.stock} -> ${p.stock}`);
    A.audit(req.user, 'product.update', row.name); res.json({ ok: true });
  } catch (e) { next(e); }
};
r.put('/products/:id', patchProduct); r.patch('/products/:id', patchProduct);
r.delete('/products/:id', (req, res) => {
  const row = db.prepare('SELECT name FROM products WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id)); // order_items keep their own snapshot
  A.audit(req.user, 'product.delete', row.name); res.json({ ok: true });
});

const FLOW = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Packed', 'Cancelled'], Packed: ['Shipped', 'Cancelled'], Shipped: ['Delivered'], Delivered: [], Cancelled: [] };
r.get('/orders', (req, res) => {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?');
  res.json({ orders: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all().map(o => ({
    no: o.number, cu: { name: o.name, email: o.email, phone: o.phone, addr: o.address }, total: o.total, status: o.status, at: o.created_at, method: o.method, pay: o.payment_status,
    items: items.all(o.id).map(i => ({ n: i.name, z: i.size, q: i.qty, p: i.price })),
  })) });
});
r.patch('/orders/:no/status', (req, res, next) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE number=?').get(req.params.no);
    const to = String((req.body || {}).status || '');
    if (!o) return res.status(404).json({ error: 'Order not found' });
    if (!(FLOW[o.status] || []).includes(to)) throw S.bad(`Cannot move an order from ${o.status} to ${to}`);
    if (o.method === 'razorpay' && o.payment_status !== 'paid' && to !== 'Cancelled') throw S.bad('Online payment has not been verified for this order');
    if (to === 'Cancelled') S.cancelOrder(o.id);
    else db.prepare("UPDATE orders SET status=?, payment_status=CASE WHEN ?='Delivered' AND method='cod' THEN 'paid' ELSE payment_status END WHERE id=?").run(to, to, o.id);
    A.audit(req.user, 'order.status', `${o.number}: ${o.status} -> ${to}`); res.json({ ok: true });
  } catch (e) { next(e); }
});

r.get('/coupons', (req, res) => res.json({ coupons: db.prepare('SELECT * FROM coupons ORDER BY id DESC').all().map(c => ({ id: c.id, code: c.code, pct: c.pct, min: c.min_order, on: !!c.active, used: c.used })) }));
r.post('/coupons', (req, res, next) => {
  try {
    const b = req.body || {}, code = String(b.code || '').trim().toUpperCase(), pct = Number(b.pct), min = Number(b.min || 0);
    if (!/^[A-Z0-9]{3,20}$/.test(code)) throw S.bad('Code must be 3-20 letters or numbers');
    if (!Number.isInteger(pct) || pct < 1 || pct > 90) throw S.bad('Discount must be 1-90%');
    if (!Number.isInteger(min) || min < 0) throw S.bad('Minimum order must be 0 or more');
    try { db.prepare('INSERT INTO coupons(code,pct,min_order) VALUES(?,?,?)').run(code, pct, min); } catch { throw S.bad('That code already exists'); }
    A.audit(req.user, 'coupon.create', code); res.json({ ok: true });
  } catch (e) { next(e); }
});
r.patch('/coupons/:id', (req, res) => { db.prepare('UPDATE coupons SET active=? WHERE id=?').run((req.body || {}).on ? 1 : 0, Number(req.params.id)); A.audit(req.user, 'coupon.toggle', req.params.id); res.json({ ok: true }); });
r.delete('/coupons/:id', (req, res) => { db.prepare('DELETE FROM coupons WHERE id=?').run(Number(req.params.id)); A.audit(req.user, 'coupon.delete', req.params.id); res.json({ ok: true }); });

r.put('/settings', A.need('owner'), (req, res, next) => {
  try {
    const b = req.body || {}, out = {};
    const txt = (k, max) => { const v = String(b[k] ?? '').trim(); if (v.length > max || (k === 'brand' && !v)) throw S.bad(`Invalid ${k}`); out[k] = v; };
    txt('brand', 40); txt('ann', 160); txt('h1', 40); txt('h2', 40); txt('sub', 200);
    for (const k of ['free', 'fee']) { const v = Number(b[k]); if (!Number.isInteger(v) || v < 0 || v > 1e6) throw S.bad(`Invalid ${k}`); out[k] = v; }
    out.cod = Number(b.cod) ? 1 : 0;
    const up = db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
    db.transaction(() => { for (const [k, v] of Object.entries(out)) up.run(k, JSON.stringify(v)); })();
    A.audit(req.user, 'settings.update'); res.json({ settings: S.settings() });
  } catch (e) { next(e); }
});
r.get('/newsletter', (req, res) => res.json({ emails: db.prepare('SELECT email FROM newsletter ORDER BY created_at DESC').all().map(x => x.email) }));
module.exports = r;
