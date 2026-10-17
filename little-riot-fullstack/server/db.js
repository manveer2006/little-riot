const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection TEXT NOT NULL, category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price > 0), sale_price INTEGER NOT NULL DEFAULT 0 CHECK(sale_price >= 0),
  color TEXT NOT NULL, stock INTEGER NOT NULL CHECK(stock >= 0), sizes TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS coupons(
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, pct INTEGER NOT NULL CHECK(pct BETWEEN 1 AND 90),
  min_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  phone TEXT NOT NULL, address TEXT NOT NULL, subtotal INTEGER NOT NULL, discount INTEGER NOT NULL,
  shipping INTEGER NOT NULL, total INTEGER NOT NULL, coupon TEXT, method TEXT NOT NULL,
  payment_status TEXT NOT NULL, status TEXT NOT NULL, rp_order_id TEXT UNIQUE, rp_payment_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER, name TEXT NOT NULL, size TEXT NOT NULL, qty INTEGER NOT NULL, price INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_events(event_id TEXT PRIMARY KEY, type TEXT, payload TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager')), created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter(email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_products_col ON products(collection, active);
`);

if (!db.prepare('SELECT 1 FROM products LIMIT 1').get() && process.env.SEED_DEMO !== 'false') {
  const ins = db.prepare('INSERT INTO products(name,collection,category,price,sale_price,color,stock,sizes,description,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,1,?)');
  const sizes = JSON.stringify(['2-3Y', '4-5Y', '6-7Y', '8-9Y']);
  const demo = [
    ['Oversized Graphic Tee', 'delhi-summer', 'Tops', 1299, 0, '#9FEBC6', 30], ['Mango Print Shirt', 'delhi-summer', 'Tops', 1699, 1399, '#FFD84D', 22],
    ['Breezy Linen Shorts', 'delhi-summer', 'Bottoms', 1199, 0, '#FF9ECF', 18], ['Sunday Sun Cap', 'delhi-summer', 'Accessories', 899, 0, '#FF5A47', 40],
    ['Cotton Co-ord Set', 'delhi-summer', 'Tops', 2499, 1999, '#9FEBC6', 12], ['Fog Hoodie', 'delhi-winter', 'Hoodies', 2499, 0, '#3155E7', 25],
    ['Colour-Block Sweatshirt', 'delhi-winter', 'Hoodies', 2199, 1799, '#FFD84D', 4], ['Chai Cargo Joggers', 'delhi-winter', 'Bottoms', 1899, 0, '#FF5A47', 20],
    ['Puffer Layering Jacket', 'delhi-winter', 'Tops', 3299, 0, '#9FEBC6', 0], ['Woolly Beanie', 'delhi-winter', 'Accessories', 799, 0, '#FF9ECF', 35],
  ];
  demo.forEach((d, i) => ins.run(d[0], d[1], d[2], d[3], d[4], d[5], d[6], sizes, 'Demo product. Replace with real fabric, fit and care details.', Date.now() - i * 1000));
}
module.exports = { db };
