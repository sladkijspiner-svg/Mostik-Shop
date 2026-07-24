// ---- Общие функции для всех страниц ----

// Telegram, куда уходят заказы и запросы на поиск фигурок
const TELEGRAM_USERNAME = "M0STlK";

function telegramLink(text) {
  return "https://t.me/" + TELEGRAM_USERNAME + "?text=" + encodeURIComponent(text);
}

function productCardHtml(p) {
  const cat = getCategory(p.category);
  return `
    <a class="product-card" href="product.html?id=${encodeURIComponent(p.id)}">
      <div class="product-thumb" style="background:${cat.gradient}">${cat.emoji}</div>
      <div class="product-body">
        <span class="product-cat-tag">${cat.short}</span>
        <span class="product-name">${p.name}</span>
        <span class="product-stock">${p.stock > 0 ? "В наличии: " + p.stock : "Нет в наличии"}</span>
        <span class="product-price">${formatPrice(p.price)}</span>
      </div>
    </a>`;
}

function categoryCardHtml(cat) {
  return `
    <a class="category-card" href="catalog.html?cat=${cat.slug}" style="background:${cat.gradient}">
      <span class="cat-emoji">${cat.emoji}</span>
      <span class="cat-label">${cat.title}</span>
    </a>`;
}

function renderCategoryGrid(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = CATEGORIES.map(categoryCardHtml).join("");
}

function initHeaderSearch() {
  const form = document.getElementById("header-search-form");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const q = form.querySelector("input").value.trim();
    window.location.href = "catalog.html" + (q ? "?q=" + encodeURIComponent(q) : "");
  });
}

document.addEventListener("DOMContentLoaded", initHeaderSearch);
