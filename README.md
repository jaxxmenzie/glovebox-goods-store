# Car & truck accessories store (v0.1)

Express + vanilla JS storefront with Stripe Checkout and a webhook-driven orders list for manual supplier fulfillment.
Working store name: **Glovebox Goods** (set `STORE_NAME`). Alternatives: **Ridgeback Auto Supply**, **Tailgate & Co.**
(No trademark or domain checks done yet.)

## Run locally
```
npm install
DATABASE_URL=pg-mem npm start   # http://localhost:3000 (in-memory DB; use a real Postgres URL to persist)
npm test             # smoke test on in-memory Postgres (pg-mem); TEST_DATABASE_URL=... runs it on a real DB
```
Checkout shows "Checkout is coming soon" and `/api/checkout` returns 503 until **both** `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are set.

## How orders work
1. Customer checks out on Stripe-hosted Checkout (US shipping address and phone collected; free shipping at $35+, otherwise $4.99 flat).
2. Stripe calls `POST /api/stripe/webhook` (`checkout.session.completed`). The server verifies the signature with `STRIPE_WEBHOOK_SECRET` and records the paid order in the Postgres `orders` table (created automatically on startup; see `db.js`), including the supplier link and unit cost for each item. Duplicate events are ignored.
3. Jaxx opens `/admin` (basic auth, any username + `ADMIN_PASSWORD`), places the same items with the supplier using the customer's address, then enters tracking and clicks **Mark fulfilled**. `/api/admin/orders.csv` exports everything.

Prices come only from `data/products.json` on the server. Supplier costs are never sent to the browser.

Database: Neon free tier (project `glovebox-goods`). Every order also stays in the Stripe Dashboard. `/healthz/db` checks the DB connection.

## Deploy
`render.yaml` describes one free web service. After approval: create it from the Blueprint, set `BASE_URL`, `STRIPE_*` and webhook secret, add the webhook endpoint `https://<app>.onrender.com/api/stripe/webhook` in Stripe for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.

## Products and images
Catalog: `data/products.json`. Each item records the supplier, the supplier URL, the cost seen on the public supplier page (Nov 17, 2026), and `imageSource`. Images in `public/img/` are the supplier's listing photos from Spocket's CDN, which are meant for retailers who import the product. Re-confirm usage rights once the supplier account exists, or swap in that supplier's own images.
