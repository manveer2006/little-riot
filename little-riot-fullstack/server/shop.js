const crypto = require('crypto');
const { db } = require('./db');
const COLLECTIONS = ['delhi-winter', 'delhi-summer'];
const CATEGORIES = ['Tops', 'Hoodies', 'Bottoms', 'Accessories'];
const bad = m => { const e = new Error(m); e.status = 400; return e; };
const rupee = n => '₹' + n.toLocaleString('en-IN');
const DEF = { brand: 'Little Riot', ann: 'THE NEW DROP IS HERE', h1: 'SMALL PEOPLE.', h2: 'BIG ENERGY.', sub: 'Clothes for the ones who were never made to blend in.', free: 1999, fee: 99, cod: 1 };
function settings() {
  const o = { ...DEF };
  for (const r of db.prepare('SELECT k,v FROM settings').all()) if (r.k in DEF) try { o[r.k] = JSON.parse(r.v); } catch {}
  return o;
}
const toClient = r => ({ id: r.id, n: r.name, col: r.collection, cat: r.category, p: r.price, s: r.sale_price, c: r.color, stock: r.stock, sizes: JSON.parse(r.sizes), on: !!r.active, d: r.description, t: r.created_at });
const razorpayOn = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

function cleanProduct(o) {
  const str = (v, min, max, label) => { v = String(v ?? '').trim(); if (v.length < min || v.length > max) throw bad(`${label} must be ${min}-${max} characters`); return v; };
  const int = (v, min, max, label) => { v = Number(v); if (!Number.isInteger(v) || v < min || v > max) throw bad(`${label} must be a whole number from ${min} to ${max}`); return v; };
  const out = {
    name: str(o.n, 1, 120, 'Name'), collection: o.col, category: o.cat, price: int(o.p, 1, 1e6, 'Price'),
    sale_price: int(o.s || 0, 0, 1e6, 'Sale price'), stock: int(o.stock, 0, 1e5, 'Stock'), color: String(o.c),
    description: String(o.d || '').slice(0, 2000), active: o.on === false ? 0 : 1,
    sizes: Array.isArray(o.sizes) ? o.sizes.map(s => String(s).trim()).filter(Boolean).slice(0, 8) : [],
  };
  if (!COLLECTIONS.includes(out.collection)) throw bad('Unknown collection');
  if (!CATEGORIES.includes(out.category)) throw bad('Unknown category');
  if (!/^#[0-9a-fA-F]{6}$/.test(out.color)) throw bad('Invalid colour');
  if (out.sale_price && out.sale_price >= out.price) throw bad('Sale price must be below the regular price');
  if (!out.sizes.length || out.sizes.some(s => s.length > 12)) throw bad('Add at least one size (max 12 characters each)');
  out.sizes = JSON.stringify(out.sizes);
  return out;
}

function quote(items, code) {
  if (!Array.isArray(items) || !items.length || items.length > 30) throw bad('Your cart is empty');
  const used = {}, lines = [];
  for (const it of items) {
    const id = Number(it.id), qty = Number(it.qty), size = String(it.size || '');
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw bad('Invalid cart item');
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
    if (!p) throw bad('An item in your cart is no longer available');
    if (!JSON.parse(p.sizes).includes(size)) throw bad(`Please choose a valid size for ${p.name}`);
    used[id] = (used[id] || 0) + qty;
    if (used[id] > p.stock) throw bad(p.stock ? `Only ${p.stock} of ${p.name} left` : `${p.name} is sold out`);
    lines.push({ id, name: p.name, size, qty, price: p.sale_price || p.price });
  }
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  let discount = 0, coupon = null, couponError = null;
  if (code) {
    const c = db.prepare('SELECT * FROM coupons WHERE code=? AND active=1').get(String(code).trim().toUpperCase());
    if (!c) couponError = 'Invalid or inactive coupon';
    else if (subtotal < c.min_order) couponError = `Minimum order for this coupon is ${rupee(c.min_order)}`;
    else { discount = Math.floor(subtotal * c.pct / 100); coupon = c.code; }
  }
  const s = settings(), shipping = subtotal - discount >= s.free ? 0 : s.fee;
  return { lines, subtotal, discount, shipping, total: subtotal - discount + shipping, coupon, couponError };
}

function createOrder(b) {
  const c = b.customer || {};
  const name = String(c.name || '').trim(), email = String(c.email || '').trim().toLowerCase();
  const phone = String(c.phone || '').replace(/\s/g, ''), address = String(c.address || '').trim();
  if (name.length < 2 || name.length > 80) throw bad('Please enter your name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) throw bad('Enter a valid email address');
  if (!/^[6-9]\d{9}$/.test(phone)) throw bad('Enter a valid 10-digit Indian mobile number');
  if (address.length < 10 || address.length > 400 || !/\b\d{6}\b/.test(address)) throw bad('Enter your full address including the 6-digit PIN code');
  const method = b.method === 'razorpay' ? 'razorpay' : 'cod';
  if (method === 'cod' && !settings().cod) throw bad('Cash on delivery is currently unavailable');
  if (method === 'razorpay' && !razorpayOn()) throw bad('Online payment is not available right now');
  return db.transaction(() => {
    const q = quote(b.items, b.coupon);
    for (const l of q.lines) {
      if (db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(l.qty, l.id, l.qty).changes !== 1) throw bad(`${l.name} just sold out`);
    }
    if (q.coupon) db.prepare('UPDATE coupons SET used=used+1 WHERE code=?').run(q.coupon);
    const r = db.prepare('INSERT INTO orders(number,name,email,phone,address,subtotal,discount,shipping,total,coupon,method,payment_status,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('tmp' + crypto.randomBytes(6).toString('hex'), name, email, phone, address, q.subtotal, q.discount, q.shipping, q.total, q.coupon, method, method === 'cod' ? 'cod_pending' : 'pending', 'Pending', Date.now());
    const id = Number(r.lastInsertRowid), number = 'LR-' + (1000 + id);
    db.prepare('UPDATE orders SET number=? WHERE id=?').run(number, id);
    for (const l of q.lines) db.prepare('INSERT INTO order_items(order_id,product_id,name,size,qty,price) VALUES(?,?,?,?,?,?)').run(id, l.id, l.name, l.size, l.qty, l.price);
    return { id, number, total: q.total, method };
  })();
}

const cancelOrder = db.transaction(id => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o || o.status === 'Cancelled') return false;
  for (const i of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.qty, i.product_id);
  if (o.coupon) db.prepare('UPDATE coupons SET used=MAX(used-1,0) WHERE code=?').run(o.coupon);
  db.prepare("UPDATE orders SET status='Cancelled', payment_status=CASE WHEN payment_status='paid' THEN 'refund_due' ELSE 'cancelled' END WHERE id=?").run(id);
  return true;
});

async function rpCreate(o) {
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64') },
    body: JSON.stringify({ amount: o.total * 100, currency: 'INR', receipt: o.number }),
  });
  if (!r.ok) throw new Error('Razorpay order failed: ' + r.status);
  return r.json();
}
const markPaid = (rpOrderId, paymentId) => {
  const n = db.prepare("UPDATE orders SET payment_status='paid', status=CASE WHEN status='Pending' THEN 'Confirmed' ELSE status END, rp_payment_id=? WHERE rp_order_id=? AND payment_status<>'paid' AND status<>'Cancelled'").run(paymentId, rpOrderId).changes;
  if (!n) db.prepare("UPDATE orders SET payment_status='refund_due', rp_payment_id=? WHERE rp_order_id=? AND status='Cancelled' AND payment_status IN ('cancelled','failed')").run(paymentId, rpOrderId);
  return n;
};
// Release stock held by online orders that were never paid (30 minutes)
setInterval(() => {
  for (const o of db.prepare("SELECT id FROM orders WHERE method='razorpay' AND payment_status IN ('pending','failed') AND status='Pending' AND created_at<?").all(Date.now() - 30 * 60e3)) cancelOrder(o.id);
}, 5 * 60e3).unref();
module.exports = { bad, settings, toClient, cleanProduct, quote, createOrder, cancelOrder, rpCreate, markPaid, razorpayOn, COLLECTIONS, CATEGORIES, DEF };
