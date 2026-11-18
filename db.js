// Postgres order store (Neon in production). DATABASE_URL=pg-mem uses an in-memory DB for tests/dev.
const SCHEMA = `CREATE TABLE IF NOT EXISTS orders (
  id                text PRIMARY KEY,
  created_at        timestamptz NOT NULL,
  status            text NOT NULL,
  customer          jsonb NOT NULL,
  shipping_address  jsonb,
  items             jsonb NOT NULL,
  amount_total      numeric(10,2) NOT NULL,
  currency          text NOT NULL,
  est_supplier_cost numeric(10,2) NOT NULL,
  payment_intent    text,
  tracking          text,
  fulfilled_at      timestamptz
)`;

function makePool(url) {
  if (url === 'pg-mem') {
    const { newDb } = require('pg-mem');
    const { Pool } = newDb().adapters.createPg();
    return new Pool();
  }
  const { Pool } = require('pg');
  return new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
}

const toOrder = r => r && ({
  id: r.id, createdAt: new Date(r.created_at).toISOString(), status: r.status,
  customer: r.customer, shippingAddress: r.shipping_address, items: r.items,
  amountTotal: Number(r.amount_total), currency: r.currency, estSupplierCost: Number(r.est_supplier_cost),
  paymentIntent: r.payment_intent, tracking: r.tracking, fulfilledAt: r.fulfilled_at ? new Date(r.fulfilled_at).toISOString() : null,
});

function createStore(url) {
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = makePool(url);
  let ready;
  const init = () => (ready ||= pool.query(SCHEMA));
  return {
    init,
    // Returns true if inserted, false if the order already existed (webhook retries).
    async insert(o) {
      await init();
      const r = await pool.query(
        `INSERT INTO orders (id, created_at, status, customer, shipping_address, items, amount_total, currency, est_supplier_cost, payment_intent, tracking)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [o.id, o.createdAt, o.status, JSON.stringify(o.customer), o.shippingAddress ? JSON.stringify(o.shippingAddress) : null,
         JSON.stringify(o.items), o.amountTotal, o.currency, o.estSupplierCost, o.paymentIntent, o.tracking]);
      return r.rowCount === 1;
    },
    async list() {
      await init();
      return (await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')).rows.map(toOrder);
    },
    async fulfill(id, tracking) {
      await init();
      const r = await pool.query(
        `UPDATE orders SET status = 'fulfilled', tracking = $2, fulfilled_at = now() WHERE id = $1 RETURNING *`, [id, tracking]);
      return toOrder(r.rows[0]);
    },
    async ping() { await pool.query('SELECT 1'); },
    end: () => pool.end(),
  };
}
module.exports = { createStore };
