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
    document.querySelectorAll('[data-cart-count]').forEach(el => { el.textContent = n; n ? el.removeAttribute('data-zero') : el.setAttribute('data-zero', ''); });
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
    if (header) header.innerHTML = `<div class="wrap"><a class="logo" href="/"><img class="mark-img" src="/icons/icon-192.png" alt=""><span>${esc(config.storeName)}</span></a>
      <a class="cart-link" href="/cart">Cart<span class="count" data-cart-count>0</span></a></div>`;
    const banner = document.querySelector('.banner');
    if (banner) banner.textContent = `Free US shipping on orders over ${money(config.freeShippingOver)}`;
    const footer = document.querySelector('footer.site');
    if (footer) footer.innerHTML = `<div class="wrap"><span>© ${new Date().getFullYear()} ${esc(config.storeName)}</span><span>Ships to US addresses · Questions? Reply to your order email</span></div>`;
    renderTabbar();
    renderCount();
    return { config, products };
  }
  // ---- home-screen app bits ----
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ICON = {
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    cats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3h2.6l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2L21 7H6"/></svg>',
  };
  function renderTabbar() {
    const nav = document.querySelector('nav.tabbar');
    if (!nav) return;
    const p = location.pathname;
    nav.innerHTML = `<a href="/" class="${p === '/' ? 'active' : ''}">${ICON.shop}<span>Shop</span></a>
      <a href="/#shop">${ICON.cats}<span>Categories</span></a>
      <a href="/cart" class="${p.startsWith('/cart') ? 'active' : ''}">${ICON.cart}<span>Cart</span><span class="badge" data-cart-count data-zero>0</span></a>`;
    const mq = window.matchMedia('(max-width: 760px)');
    const apply = () => document.documentElement.classList.toggle('has-tabbar', mq.matches || isStandalone());
    apply(); mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  }
  const HINT_KEY = 'a2hs_hint_dismissed';
  function showHint(html, onGo) {
    if (document.querySelector('.install-hint')) return;
    const el = document.createElement('div');
    el.className = 'install-hint'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Add to Home Screen');
    el.innerHTML = `<img src="/icons/icon-192.png" alt=""><div class="txt">${html}</div>${onGo ? '<button class="go">Install</button>' : ''}<button class="x" aria-label="Dismiss">×</button>`;
    el.querySelector('.x').onclick = () => { localStorage.setItem(HINT_KEY, '1'); el.remove(); };
    if (onGo) el.querySelector('.go').onclick = async () => { el.remove(); await onGo(); };
    document.body.appendChild(el);
  }
  function setupInstall() {
    if (isStandalone()) { document.documentElement.classList.add('standalone'); return; }
    if (localStorage.getItem(HINT_KEY) || location.pathname !== '/') return; // home page only, never mid-shopping
    // Android / Chrome: real install prompt
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      showHint('<strong>Install Glovebox</strong><br>One tap from your home screen.', async () => {
        e.prompt();
        const { outcome } = await e.userChoice;
        if (outcome === 'dismissed') localStorage.setItem(HINT_KEY, '1');
      });
    });
    window.addEventListener('appinstalled', () => { localStorage.setItem(HINT_KEY, '1'); document.querySelector('.install-hint')?.remove(); });
    // iOS Safari: no prompt API, so a one-time tip
    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
    if (iOS && safari) setTimeout(() => showHint('<strong>Add to Home Screen</strong><br>Tap <svg class="share" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg> Share, then <strong>Add to Home Screen</strong>.'), 2500);
  }
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  setupInstall();

  return { init, add, setQty, clear, getCart, money, esc, toast, get products() { return products; }, get config() { return config; } };
})();
