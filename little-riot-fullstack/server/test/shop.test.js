process.env.DB_PATH = ':memory:';
process.env.SEED_DEMO = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = 'secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const app = require('../index');
const { db } = require('../db');
const { hash } = require('../auth');
const S = require('../shop');

let base, cookie = '';
const server = app.listen(0, '127.0.0.1');
test.before(async () => {
  db.prepare("INSERT INTO users(email,pass_hash,role,created_at) VALUES('boss@test.com',?, 'owner', 1)").run(hash('correct-horse-battery'));
  db.prepare("INSERT INTO users(email,pass_hash,role,created_at) VALUES('mgr@test.com',?, 'manager', 1)").run(hash('correct-horse-battery'));
  if (!server.listening) await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());
const call = async (path, method = 'GET', body, ck = cookie) => {
  const r = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})), setCookie: r.headers.get('set-cookie') };
};
const cust = { name: 'Test Parent', email: 'p@test.com', phone: '9876543210', address: '12 Lodhi Road, New Delhi 110003' };
const prod = name => db.prepare('SELECT * FROM products WHERE name=?').get(name);

test('admin APIs reject anonymous users', async () => {
  for (const p of ['/api/admin/products', '/api/admin/orders', '/api/admin/coupons']) assert.equal((await call(p, 'GET', null, '')).status, 401);
  assert.equal((await call('/api/admin/products', 'POST', { n: 'x' }, '')).status, 401);
});
test('login fails with wrong password and works with right one', async () => {
  assert.equal((await call('/api/admin/login', 'POST', { email: 'boss@test.com', password: 'wrong' })).status, 401);
  const ok = await call('/api/admin/login', 'POST', { email: 'boss@test.com', password: 'correct-horse-battery' });
  assert.equal(ok.status, 200); assert.match(ok.setCookie, /HttpOnly/i);
  cookie = ok.setCookie.split(';')[0];
});
test('managers cannot change settings; owners can', async () => {
  const m = await call('/api/admin/login', 'POST', { email: 'mgr@test.com', password: 'correct-horse-battery' });
  assert.equal((await call('/api/admin/settings', 'PUT', {}, m.setCookie.split(';')[0])).status, 403);
  const body = { ...S.settings(), brand: 'Little Riot', free: 1999, fee: 99, cod: 1 };
  assert.equal((await call('/api/admin/settings', 'PUT', body)).status, 200);
});
test('server ignores client prices and calculates totals', () => {
  const p = prod('Fog Hoodie');
  const q = S.quote([{ id: p.id, size: '2-3Y', qty: 2, price: 1 }], null);
  assert.equal(q.subtotal, 2 * p.price);
  assert.equal(q.shipping, 0); // above the free-shipping threshold
});
test('invalid size, qty and unknown coupon are handled', () => {
  const p = prod('Fog Hoodie');
  assert.throws(() => S.quote([{ id: p.id, size: 'XXL', qty: 1 }]), /valid size/);
  assert.throws(() => S.quote([{ id: p.id, size: '2-3Y', qty: -1 }]), /Invalid/);
  assert.equal(S.quote([{ id: p.id, size: '2-3Y', qty: 1 }], 'NOPE').couponError, 'Invalid or inactive coupon');
});
test('sold-out and hidden products cannot be bought', () => {
  assert.throws(() => S.quote([{ id: prod('Puffer Layering Jacket').id, size: '2-3Y', qty: 1 }]), /sold out/);
  const p = prod('Woolly Beanie'); db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.id);
  assert.throws(() => S.quote([{ id: p.id, size: '2-3Y', qty: 1 }]), /no longer available/);
});
test('stock can never go negative (no overselling)', () => {
  const p = prod('Colour-Block Sweatshirt'); // 4 in stock
  const items = [{ id: p.id, size: '2-3Y', qty: 3 }];
  S.createOrder({ customer: cust, items, method: 'cod' });
  assert.throws(() => S.createOrder({ customer: cust, items, method: 'cod' }), /Only 1/);
  assert.equal(prod('Colour-Block Sweatshirt').stock, 1);
});
test('checkout rejects bad phone, email and PIN', () => {
  const items = [{ id: prod('Fog Hoodie').id, size: '2-3Y', qty: 1 }];
  assert.throws(() => S.createOrder({ customer: { ...cust, phone: '12345' }, items }), /mobile/);
  assert.throws(() => S.createOrder({ customer: { ...cust, email: 'nope' }, items }), /email/);
  assert.throws(() => S.createOrder({ customer: { ...cust, address: 'Somewhere in Delhi city' }, items }), /PIN/);
});
test('coupon applies server-side and respects minimum order', async () => {
  await call('/api/admin/coupons', 'POST', { code: 'RIOT10', pct: 10, min: 1000 });
  const p = prod('Fog Hoodie');
  assert.equal(S.quote([{ id: p.id, size: '2-3Y', qty: 1 }], 'riot10').discount, Math.floor(p.price / 10));
  const cheap = prod('Sunday Sun Cap'); // 899 < 1000
  assert.match(S.quote([{ id: cheap.id, size: '2-3Y', qty: 1 }], 'RIOT10').couponError, /Minimum/);
});
test('order status transitions are enforced, and COD delivery marks paid', async () => {
  const o = S.createOrder({ customer: cust, items: [{ id: prod('Fog Hoodie').id, size: '4-5Y', qty: 1 }], method: 'cod' });
  assert.equal((await call(`/api/admin/orders/${o.number}/status`, 'PATCH', { status: 'Delivered' })).status, 400);
  for (const s of ['Confirmed', 'Packed', 'Shipped', 'Delivered']) assert.equal((await call(`/api/admin/orders/${o.number}/status`, 'PATCH', { status: s })).status, 200);
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE number=?').get(o.number).payment_status, 'paid');
});
test('cancelling an order restores stock', async () => {
  const p = prod('Chai Cargo Joggers'), before = p.stock;
  const o = S.createOrder({ customer: cust, items: [{ id: p.id, size: '2-3Y', qty: 2 }], method: 'cod' });
  assert.equal(prod('Chai Cargo Joggers').stock, before - 2);
  assert.equal((await call(`/api/admin/orders/${o.number}/status`, 'PATCH', { status: 'Cancelled' })).status, 200);
  assert.equal(prod('Chai Cargo Joggers').stock, before);
});
test('online order cannot be confirmed by staff until payment is verified; webhook is signed and idempotent', async () => {
  const o = S.createOrder({ customer: cust, items: [{ id: prod('Fog Hoodie').id, size: '6-7Y', qty: 1 }], method: 'razorpay' });
  db.prepare('UPDATE orders SET rp_order_id=? WHERE id=?').run('order_TEST1', o.id);
  assert.equal((await call(`/api/admin/orders/${o.number}/status`, 'PATCH', { status: 'Confirmed' })).status, 400);
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', order_id: 'order_TEST1' } } } });
  const sig = crypto.createHmac('sha256', 'whsec').update(body).digest('hex');
  const send = s => fetch(base + '/api/payments/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': s, 'x-razorpay-event-id': 'evt_1' }, body });
  assert.equal((await send('bad')).status, 400);
  assert.equal((await send(sig)).status, 200);
  assert.equal((await (await send(sig)).json()).duplicate, true);
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
  assert.equal(row.payment_status, 'paid'); assert.equal(row.status, 'Confirmed');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM payment_events WHERE event_id='evt_1'").get().c, 1);
});
test('bad payment signature is rejected', async () => {
  const o = S.createOrder({ customer: cust, items: [{ id: prod('Fog Hoodie').id, size: '8-9Y', qty: 1 }], method: 'razorpay' });
  db.prepare('UPDATE orders SET rp_order_id=? WHERE id=?').run('order_TEST2', o.id);
  const r = await call('/api/payments/verify', 'POST', { number: o.number, razorpay_order_id: 'order_TEST2', razorpay_payment_id: 'pay_TEST2', razorpay_signature: 'forged' });
  assert.equal(r.status, 400);
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(o.id).payment_status, 'pending');
});
test('public store hides inactive products and non-JSON writes are refused', async () => {
  const store = await call('/api/store', 'GET', null, '');
  assert.ok(store.json.products.length > 0 && store.json.products.every(p => p.on));
  const r = await fetch(base + '/api/newsletter', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'email=a@b.co' });
  assert.equal(r.status, 415);
});
