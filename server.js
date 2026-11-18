// Car & truck accessories store: Express + Stripe Checkout.
// Payments stay disabled until STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY are set.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const STORE_NAME = process.env.STORE_NAME || 'Glovebox Goods';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const FREE_SHIPPING_OVER = Number(process.env.FREE_SHIPPING_OVER || 35); // USD
const FLAT_SHIPPING = Number(process.env.FLAT_SHIPPING || 4.99);          // USD
const MAX_QTY = 10;

const paymentsConfigured = Boolean(STRIPE_SECRET_KEY && STRIPE_PUBLISHABLE_KEY);
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

// Catalog: full records (incl. supplier cost) stay server-side; only public fields go to the browser.
const PRODUCTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf8'));
const byId = new Map(PRODUCTS.map(p => [p.id, p]));
const publicProduct = ({ id, name, category, price, blurb, bullets, image }) => ({ id, name, category, price, blurb, bullets, image });

// ---- orders store: Postgres (see db.js) ----
const store = require('./db').createStore(DATABASE_URL);
function encodeCart(items) { return items.map(i => `${i.id}:${i.qty}`).join(','); }
function decodeCart(s) {
  return String(s || '').split(',').filter(Boolean).map(x => { const [id, q] = x.split(':'); return { id, qty: Number(q) }; });
}
// Validate a cart against the server catalog (never trust client prices).
function normalizeCart(raw) {
  if (!Array.isArray(raw)) return [];
  const merged = new Map();
  for (const it of raw) {
    const p = byId.get(String(it && it.id));
    const qty = Math.floor(Number(it && it.qty));
    if (!p || !(qty > 0)) continue;
    merged.set(p.id, Math.min(MAX_QTY, (merged.get(p.id) || 0) + qty));
  }
  return [...merged].map(([id, qty]) => ({ id, qty }));
}
const cents = n => Math.round(n * 100);

// Turn a completed Checkout Session into an order record for supplier fulfillment.
async function recordPaidOrder(session) {
  const items = decodeCart(session.metadata && session.metadata.cart).map(({ id, qty }) => {
    const p = byId.get(id) || {};
    return {
      id, qty, name: p.name, unitPrice: p.price,
      supplier: p.supplier ? { platform: p.supplier.platform, name: p.supplier.name, url: p.supplier.url, unitCost: p.supplier.cost } : null,
    };
  });
  const ship = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || {};
  const order = {
    id: session.id,
    createdAt: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    status: 'paid_awaiting_fulfillment',
    customer: {
      email: session.customer_details && session.customer_details.email,
      name: (ship.name) || (session.customer_details && session.customer_details.name),
      phone: session.customer_details && session.customer_details.phone,
    },
    shippingAddress: ship.address || (session.customer_details && session.customer_details.address) || null,
    items,
    amountTotal: (session.amount_total || 0) / 100,
    currency: session.currency || 'usd',
    estSupplierCost: Number(items.reduce((s, i) => s + (i.supplier ? i.supplier.unitCost * i.qty : 0), 0).toFixed(2)),
    paymentIntent: session.payment_intent || null,
    tracking: null,
  };
  const inserted = await store.insert(order);
  return inserted ? { order } : { duplicate: true };
}

const app = express();
app.disable('x-powered-by');

// Stripe webhook needs the raw body, so it's registered before express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook not configured' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    const s = event.data.object;
    if (s.payment_status === 'paid') {
      try {
        const r = await recordPaidOrder(s);
        console.log(r.duplicate ? `Order ${s.id} already recorded` : `Recorded paid order ${s.id}`);
      } catch (err) {
        console.error('Failed to record order', s.id, err.message);
        return res.status(500).json({ error: 'db_error' }); // Stripe retries on non-2xx
      }
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '50kb' }));
// PWA: manifest + service worker must not be cached long, and need the right content types.
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').set('Cache-Control', 'no-cache')
    .sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});
app.get('/sw.js', (req, res) => {
  res.type('application/javascript').set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' })
    .sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));

app.get('/api/config', (req, res) => res.json({
  storeName: STORE_NAME, paymentsConfigured, publishableKey: paymentsConfigured ? STRIPE_PUBLISHABLE_KEY : null,
  freeShippingOver: FREE_SHIPPING_OVER, flatShipping: FLAT_SHIPPING,
}));
app.get('/api/products', (req, res) => res.json(PRODUCTS.map(publicProduct)));
app.get('/api/products/:id', (req, res) => {
  const p = byId.get(req.params.id);
  p ? res.json(publicProduct(p)) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/checkout', async (req, res) => {
  if (!paymentsConfigured) {
    return res.status(503).json({ error: 'payments_not_configured', message: 'Payments are not set up yet. Check back soon!' });
  }
  const items = normalizeCart(req.body && req.body.items);
  if (!items.length) return res.status(400).json({ error: 'empty_cart', message: 'Your cart is empty.' });
  const subtotal = items.reduce((s, i) => s + byId.get(i.id).price * i.qty, 0);
  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : FLAT_SHIPPING;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: items.map(i => {
        const p = byId.get(i.id);
        return {
          quantity: i.qty,
          price_data: {
            currency: 'usd', unit_amount: cents(p.price),
            product_data: { name: p.name, images: [`${BASE_URL}${p.image}`], metadata: { product_id: p.id } },
          },
        };
      }),
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount', display_name: shipping ? 'Standard shipping' : 'Free shipping',
          fixed_amount: { amount: cents(shipping), currency: 'usd' },
          delivery_estimate: { minimum: { unit: 'business_day', value: 3 }, maximum: { unit: 'business_day', value: 10 } },
        },
      }],
      phone_number_collection: { enabled: true },
      metadata: { cart: encodeCart(items) },
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cart`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(502).json({ error: 'stripe_error', message: 'Could not start checkout. Please try again.' });
  }
});

// ---- admin: orders to fulfill with the supplier ----
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('Admin disabled: set ADMIN_PASSWORD.');
  const [scheme, b64] = (req.headers.authorization || '').split(' ');
  const pass = scheme === 'Basic' && b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  const a = Buffer.from(pass), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="orders"').status(401).send('Auth required');
}
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
app.get('/api/admin/orders', requireAdmin, wrap(async (req, res) => res.json(await store.list())));
app.post('/api/admin/orders/:id/fulfill', requireAdmin, wrap(async (req, res) => {
  const o = await store.fulfill(req.params.id, String((req.body && req.body.tracking) || '').slice(0, 120) || null);
  o ? res.json(o) : res.status(404).json({ error: 'Not found' });
}));
app.get('/api/admin/orders.csv', requireAdmin, wrap(async (req, res) => {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = [['order_id', 'created', 'status', 'name', 'email', 'phone', 'line1', 'line2', 'city', 'state', 'zip', 'country', 'product', 'qty', 'supplier', 'supplier_url', 'tracking']];
  for (const o of await store.list()) for (const i of o.items) {
    const a = o.shippingAddress || {};
    rows.push([o.id, o.createdAt, o.status, o.customer.name, o.customer.email, o.customer.phone, a.line1, a.line2, a.city, a.state, a.postal_code, a.country, i.name, i.qty, i.supplier && `${i.supplier.platform} / ${i.supplier.name}`, i.supplier && i.supplier.url, o.tracking]);
  }
  res.type('text/csv').send(rows.map(r => r.map(esc).join(',')).join('\n'));
}));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/healthz/db', wrap(async (req, res) => { await store.ping(); res.json({ ok: true }); }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'server_error' }); });

if (require.main === module) {
  store.init()
    .then(() => console.log('Database ready'))
    .catch(err => console.error('Database init failed (will retry on first use):', err.message));
  app.listen(PORT, () => console.log(`${STORE_NAME} running on ${BASE_URL} (payments ${paymentsConfigured ? 'ON' : 'not configured'})`));
}
module.exports = { app, recordPaidOrder, normalizeCart };
