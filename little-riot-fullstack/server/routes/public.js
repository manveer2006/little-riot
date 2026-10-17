const express = require('express');
const { db } = require('../db');
const { limit } = require('../auth');
const S = require('../shop');
const r = express.Router();
r.get('/store', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY created_at DESC, id DESC').all().map(S.toClient);
  res.json({ settings: S.settings(), products, config: { razorpay: S.razorpayOn() } });
});
r.post('/quote', limit(120, 60e3), (req, res, next) => { try { res.json(S.quote(req.body.items, req.body.coupon)); } catch (e) { next(e); } });
r.post('/orders', limit(15, 10 * 60e3), async (req, res, next) => {
  try {
    const o = S.createOrder(req.body || {});
    if (o.method === 'razorpay') {
      try {
        const ro = await S.rpCreate(o);
        db.prepare('UPDATE orders SET rp_order_id=? WHERE id=?').run(ro.id, o.id);
        return res.json({ number: o.number, razorpay: { key: process.env.RAZORPAY_KEY_ID, order_id: ro.id, amount: ro.amount } });
      } catch (e) { console.error(e.message); S.cancelOrder(o.id); throw S.bad('Could not start payment. Please try again.'); }
    }
    res.json({ number: o.number });
  } catch (e) { next(e); }
});
r.post('/newsletter', limit(10, 10 * 60e3), (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) throw S.bad('Enter a valid email address');
    db.prepare('INSERT OR IGNORE INTO newsletter VALUES(?,?)').run(email, Date.now());
    res.json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = r;
