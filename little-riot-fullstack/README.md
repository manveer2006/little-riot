# Little Riot Collective

Kidswear store with a real backend: Express + SQLite API, a storefront, and a role-protected admin panel.

```
server/            API (Node.js)
  index.js         app setup, security headers, JSON-only writes
  db.js            schema + optional demo seed
  auth.js          scrypt passwords, server-side sessions, roles, rate limiting, audit log
  shop.js          pricing, stock, coupons, order creation, cancellation, Razorpay helpers
  routes/          public.js (store, quote, orders, newsletter), payments.js (verify + webhook), admin.js
  create-admin.js  creates the first admin
  test/            automated tests (npm test)
public/            storefront + admin UI (index.html, css/style.css, js/app.js)
```

## Run locally
Requires Node 20.12+.

```bash
npm install
cp .env.example .env
npm run create-admin -- you@example.com "choose-a-long-password"   # at least 10 characters
npm start        # http://localhost:3000    admin: http://localhost:3000/#/admin
npm test
```

## What works now
- Products, collections (Delhi Winter / Delhi Summer), Shop All with filters and sorting, product pages.
- Cart: totals, coupons, shipping and stock are all calculated **on the server**; client prices are ignored.
- Orders: transactional stock decrement (no overselling), order snapshots, enforced status flow, cancelling restores stock.
- Cash on Delivery (toggle in Admin > Store & content).
- Razorpay online payments: server-created orders, signature verification, signed and idempotent webhook. **Disabled until keys are set, and not yet tested against Razorpay itself.**
- Admin: login, roles (owner / manager), products CRUD, stock edits, orders and statuses, coupons, store settings, newsletter list, audit log (table `audit`).

## Razorpay setup (test mode first)
1. Create a Razorpay account and put the test Key Id and Key Secret in `.env`.
2. Dashboard > Webhooks: add `https://YOUR-DOMAIN/api/payments/webhook` with events `payment.captured`, `payment.failed`, `order.paid`; put its secret in `RAZORPAY_WEBHOOK_SECRET`.
3. Test with Razorpay test cards/UPI, including a failed payment and a closed popup. Switch to live keys only after that.

Unpaid online orders release their stock after 30 minutes.

## Deploy
Use a host with a **persistent disk** (Render, Railway, Fly.io, or a VPS). Set `NODE_ENV=production`, `SEED_DEMO=false`, `DB_PATH` on the persistent disk, and the Razorpay variables. Serve over HTTPS (needed for secure cookies and Razorpay). Back up the SQLite file regularly, for example `sqlite3 data.db ".backup backup.db"`. Never commit `.env` or `data.db`.

## Not built yet (be honest before launch)
- Customer accounts, wishlist, saved addresses, customer order-tracking page.
- Product image upload (products use colour blocks; add storage such as S3 or Cloudinary).
- Transactional email, refunds through the Razorpay API (refunds are manual; affected orders show `refund_due`), returns workflow, reviews.
- GST/tax rules, shipping-carrier integration, password reset, SEO-friendly server-rendered pages, an admin screen for adding more admin users (use `create-admin`).
- Real policy pages (shipping, returns, privacy, terms) and your real brand copy. Have them reviewed before taking real orders.
