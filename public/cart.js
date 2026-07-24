// ---- Корзина (хранится в localStorage) ----
const CART_KEY = "minifig_cart_v1";

function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(id, qty) {
  qty = qty || 1;
  const cart = getCart();
  const existing = cart.find(i => i.id === id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ id: id, qty: qty });
  }
  saveCart(cart);
}

function setCartQty(id, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter(i => i.id !== id);
  } else {
    const existing = cart.find(i => i.id === id);
    if (existing) existing.qty = qty;
  }
  saveCart(cart);
}

function removeFromCart(id) {
  const cart = getCart().filter(i => i.id !== id);
  saveCart(cart);
}

function clearCart() {
  saveCart([]);
}

function getCartCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function getCartDetailed() {
  const products = loadProducts();
  return getCart().map(item => {
    const product = products.find(p => p.id === item.id);
    if (!product) return null;
    return { product: product, qty: item.qty, lineTotal: product.price * item.qty };
  }).filter(Boolean);
}

function getCartTotal() {
  return getCartDetailed().reduce((sum, i) => sum + i.lineTotal, 0);
}

function updateCartBadge() {
  document.querySelectorAll(".cart-badge").forEach(el => {
    el.textContent = getCartCount();
  });
}

document.addEventListener("DOMContentLoaded", updateCartBadge);
