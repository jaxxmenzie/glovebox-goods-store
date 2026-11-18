// Shared storefront logic: config, cart (localStorage), header/footer.
const Store = (() => {
  const KEY = 'cart_v1';
  let config = null, products = null;
  const money = n => `$${Number(n).toFixed(2)}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getCart = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const saveCart = c => { localStorage.setItem(KEY, JSON.stringify(c)); renderCount(); };
  function add(id, qty = 1) {
    const c = getCart(); const it = c.find(i => i.id === id);
    if (it) it.qty = Math.min(10, it.qty + qty); else c.push({ id, qty: Math.min(10, qty) });
    saveCart(c); toast('Added to cart');
  }
  function setQty(id, qty) {
    let c = getCart();
    c = qty <= 0 ? c.filter(i => i.id !== id) : c.map(i => i.id === id ? { ...i, qty: Math.min(10, qty) } : i);
    saveCart(c);
  }
  const clear = () => saveCart([]);
  function renderCount() {
    const n = getCart().reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll('[data-cart-count]').forEach(el => el.textContent = n);
  }
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
  }
  async function init() {
    [config, products] = await Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/products').then(r => r.json())]);
    document.querySelectorAll('[data-store-name]').forEach(el => el.textContent = config.storeName);
    document.title = document.title.replace('{store}', config.storeName);
    const header = document.querySelector('header.site');
    if (header) header.innerHTML = `<div class="wrap"><a class="logo" href="/"><span class="mark">🛻</span><span>${esc(config.storeName)}</span></a>
      <a class="cart-link" href="/cart">Cart<span class="count" data-cart-count>0</span></a></div>`;
    const banner = document.querySelector('.banner');
    if (banner) banner.textContent = `Free US shipping on orders over ${money(config.freeShippingOver)}`;
    const footer = document.querySelector('footer.site');
    if (footer) footer.innerHTML = `<div class="wrap"><span>© ${new Date().getFullYear()} ${esc(config.storeName)}</span><span>Ships to US addresses · Questions? Reply to your order email</span></div>`;
    renderCount();
    return { config, products };
  }
  return { init, add, setQty, clear, getCart, money, esc, toast, get products() { return products; }, get config() { return config; } };
})();
