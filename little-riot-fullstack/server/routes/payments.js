const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const S = require('../shop');
const r = express.Router();
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
r.post('/verify', (req, res, next) => {
  try {
    if (!S.razorpayOn()) return res.status(404).json({ error: 'Online payments are not enabled' });
    const b = req.body || {}, oid = String(b.razorpay_order_id || ''), pid = String(b.razorpay_payment_id || ''), sig = String(b.razorpay_signature || '');
    const o = db.prepare('SELECT * FROM orders WHERE number=? AND rp_order_id=?').get(String(b.number || ''), oid);
    if (!o || !/^[\w-]{5,64}$/.test(pid)) throw S.bad('Invalid payment details');
    const exp = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(oid + '|' + pid).digest('hex');
    if (!safeEq(exp, sig)) throw S.bad('Payment verification failed');
    S.markPaid(oid, pid); // idempotent
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Raw body is required for signature verification (see index.js)
r.post('/webhook', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).end();
  const raw = req.body;
  if (!Buffer.isBuffer(raw)) return res.status(400).end();
  const exp = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!safeEq(exp, String(req.get('x-razorpay-signature') || ''))) return res.status(400).end();
  let ev; try { ev = JSON.parse(raw.toString()); } catch { return res.status(400).end(); }
  try { db.prepare('INSERT INTO payment_events(event_id,type,payload,at) VALUES(?,?,?,?)').run(req.get('x-razorpay-event-id') || crypto.randomUUID(), ev.event, raw.toString(), Date.now()); }
  catch { return res.json({ ok: true, duplicate: true }); }
  const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
  if (pay) {
    if (ev.event === 'payment.captured' || ev.event === 'order.paid') S.markPaid(pay.order_id, pay.id);
    else if (ev.event === 'payment.failed') db.prepare("UPDATE orders SET payment_status='failed' WHERE rp_order_id=? AND payment_status='pending'").run(pay.order_id);
  }
  res.json({ ok: true });
});
module.exports = r;
