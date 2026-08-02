// Простое хранилище товаров на JSON-файле.
// Файл лежит в data/state/ — это папка на постоянном диске Railway (Volume),
// который НЕ пересоздаётся при деплое (в отличие от обычных файлов
// репозитория). Стартовая копия при самом первом запуске подготавливается
// в server/bootstrap.js.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data", "state", "products.json");

const CATEGORIES = [
  { slug: "marvel", title: "Минифигурки Marvel" },
  { slug: "dc", title: "Минифигурки DC" },
  { slug: "other", title: "Минифигурки Прочее" },
  { slug: "packs", title: "Паки минифигурок" },
  { slug: "sets", title: "Наборы" }
];

function loadProducts() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function saveProducts(products) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), "utf8");
}

function getCategories() {
  return CATEGORIES;
}

function isValidCategory(slug) {
  return CATEGORIES.some(c => c.slug === slug);
}

function findProduct(id) {
  return loadProducts().find(p => p.id === id);
}

function addProduct({ category, name, price, stock, desc }) {
  const products = loadProducts();
  const countInCat = products.filter(p => p.category === category).length + 1;
  const product = {
    id: category + "-" + Date.now(),
    category,
    name,
    price: Number(price),
    stock: Number(stock),
    sku: category.toUpperCase() + "-" + String(countInCat).padStart(3, "0"),
    desc: desc || ""
  };
  products.push(product);
  saveProducts(products);
  return product;
}

function removeProduct(id) {
  const products = loadProducts();
  const idx = products.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const [removed] = products.splice(idx, 1);
  saveProducts(products);
  return removed;
}

function updateProduct(id, patch) {
  const products = loadProducts();
  const p = products.find(x => x.id === id);
  if (!p) return null;
  Object.assign(p, patch);
  saveProducts(products);
  return p;
}

module.exports = {
  loadProducts,
  saveProducts,
  getCategories,
  isValidCategory,
  findProduct,
  addProduct,
  removeProduct,
  updateProduct
};
