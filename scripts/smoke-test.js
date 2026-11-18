// Offline smoke test: pages render, cart API validates, checkout is gated, webhook records orders.
// Uses fake Stripe secrets (no calls to Stripe). DB: in-memory pg-mem by default, or a real Postgres via
// TEST_DATABASE_URL (the test row it inserts is deleted afterwards).
const { spawn } = require('child_process');
const os = require('os'), fs = require('fs'), path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const DB = process.env.TEST_DATABASE_URL || 'pg-mem';
const SID = 'cs_test_smoke_' + Date.now();

function start(port, env) {
  const p = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: port, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise(res => p.stdout.on('data', d => { if (/running on/.test(d)) res(p); }));
}
(async () => {
  // 1) No Stripe keys
  const a = await start(3101, { STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: '', ADMIN_PASSWORD: '', DATABASE_URL: DB });
  const A = 'http://localhost:3101';
  for (const u of ['/', '/product?id=tire-gauge', '/cart', '/success', '/styles.css', '/app.js', '/img/tire-gauge.jpg']) {
    const r = await fetch(A + u); assert.equal(r.status, 200, u); console.log('200', u);
  }
  // PWA routes
  const man = await fetch(A + '/manifest.webmanifest');
  assert.equal(man.status, 200); assert.match(man.headers.get('content-type'), /application\/manifest\+json/);
  const mj = await man.json();
  assert.equal(mj.display, 'standalone'); assert.equal(mj.start_url.split('?')[0], '/'); assert.equal(mj.scope, '/');
  for (const need of ['192x192', '512x512']) assert.ok(mj.icons.some(i => i.sizes === need && i.purpose !== 'maskable'), 'icon ' + need);
  assert.ok(mj.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'), 'maskable 512');
  for (const i of [...mj.icons, { src: '/icons/apple-touch-icon.png' }]) {
    const r = await fetch(A + i.src); assert.equal(r.status, 200, i.src); assert.match(r.headers.get('content-type'), /image\/png/);
  }
  console.log('manifest OK (' + mj.icons.length + ' icons + apple-touch-icon load)');
  const sw = await fetch(A + '/sw.js'); const swText = await sw.text();
  assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/); assert.match(sw.headers.get('cache-control'), /no-cache/);
  for (const p of ['admin', 'api\\/checkout', 'api\\/stripe']) assert.ok(swText.includes(p), 'sw bypasses ' + p);
  assert.equal((await fetch(A + '/offline')).status, 200);
  const home = await (await fetch(A + '/')).text();
  for (const tag of ['rel="manifest"', 'apple-touch-icon', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title', 'name="theme-color"', 'viewport-fit=cover']) assert.ok(home.includes(tag), tag);
  console.log('sw.js OK (no-cache, bypasses admin/checkout/stripe), /offline OK, PWA head tags present');
  const prods = await (await fetch(A + '/api/products')).json();
  assert.ok(prods.length >= 8); assert.ok(!('supplier' in prods[0]), 'supplier cost must not leak');
  console.log(`products: ${prods.length}, supplier fields hidden`);
  const cfg = await (await fetch(A + '/api/config')).json(); assert.equal(cfg.paymentsConfigured, false);
  const co = await fetch(A + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'tire-gauge', qty: 1 }] }) });
  assert.equal(co.status, 503); console.log('checkout without keys ->', co.status, (await co.json()).error);
  assert.equal((await fetch(A + '/admin')).status, 503); console.log('admin without password -> 503');
  assert.equal((await fetch(A + '/api/stripe/webhook', { method: 'POST', body: '{}' })).status, 503);
  a.kill();

  // 2) Fake keys: verify webhook signature handling + order recording
  const secret = 'whsec_test_local';
  const b = await start(3102, { STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_PUBLISHABLE_KEY: 'pk_test_dummy', STRIPE_WEBHOOK_SECRET: secret, ADMIN_PASSWORD: 'pw', DATABASE_URL: DB });
  const B = 'http://localhost:3102';
  const stripe = require('stripe')('sk_test_dummy');
  const event = { id: 'evt_test', object: 'event', type: 'checkout.session.completed', data: { object: {
    id: SID, object: 'checkout.session', created: Math.floor(Date.now() / 1000), payment_status: 'paid', amount_total: 6698, currency: 'usd',
    metadata: { cart: 'tire-gauge:1,dash-mat:2' }, payment_intent: 'pi_test',
    customer_details: { email: 'buyer@example.com', name: 'Test Buyer', phone: '+15555550100' },
    collected_information: { shipping_details: { name: 'Test Buyer', address: { line1: '1 Main St', city: 'Spokane', state: 'WA', postal_code: '99201', country: 'US' } } },
  } } };
  const payload = JSON.stringify(event);
  const bad = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: payload });
  assert.equal(bad.status, 400); console.log('webhook bad signature -> 400');
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret });
  for (let i = 0; i < 2; i++) { // second call checks idempotency
    const ok = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
    assert.equal(ok.status, 200);
  }
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
  const orders = (await (await fetch(B + '/api/admin/orders', { headers: auth })).json()).filter(o => o.id === SID);
  assert.equal(orders.length, 1, 'exactly one order despite duplicate webhook'); assert.equal(orders[0].items.length, 2);
  assert.equal(orders[0].shippingAddress.city, 'Spokane'); assert.equal(orders[0].amountTotal, 66.98);
  console.log('webhook recorded order:', orders[0].id, orders[0].status, orders[0].items.map(i => `${i.qty}x ${i.id}`).join(', '), 'est supplier cost $' + orders[0].estSupplierCost);
  const f = await (await fetch(B + `/api/admin/orders/${SID}/fulfill`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ tracking: '9400TEST' }) })).json();
  assert.equal(f.status, 'fulfilled'); console.log('mark fulfilled ->', f.status, f.tracking);
  const csv = await (await fetch(B + '/api/admin/orders.csv', { headers: auth })).text();
  const csvRows = csv.split('\n').filter(l => l.includes(SID)); assert.equal(csvRows.length, 2); console.log('CSV export rows for order:', csvRows.length);
  assert.equal((await fetch(B + '/healthz/db')).status, 200); console.log('db health -> 200');
  assert.equal((await fetch(B + '/api/admin/orders')).status, 401); console.log('admin without auth -> 401');
  b.kill();
  if (DB !== 'pg-mem') {
    const { Client } = require('pg'); const c = new Client({ connectionString: DB }); await c.connect();
    await c.query('DELETE FROM orders WHERE id = $1', [SID]); await c.end(); console.log('cleaned up test row in real DB');
  }
  console.log(`ALL SMOKE TESTS PASSED (db: ${DB === 'pg-mem' ? 'pg-mem' : 'real Postgres'})`);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
