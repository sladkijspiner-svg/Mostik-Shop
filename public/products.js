// ---- Категории ----
const CATEGORIES = [
  { slug: "marvel", title: "Минифигурки Marvel", short: "Marvel", emoji: "🦸", gradient: "linear-gradient(135deg,#7a1e2e,#1c3f7a)" },
  { slug: "dc",     title: "Минифигурки DC",     short: "DC",     emoji: "🦇", gradient: "linear-gradient(135deg,#0d1b2a,#1b263b)" },
  { slug: "other",  title: "Минифигурки Прочее", short: "Прочее", emoji: "🧱", gradient: "linear-gradient(135deg,#4a4a5a,#6b3f7a)" },
  { slug: "packs",  title: "Паки минифигурок",   short: "Паки",   emoji: "📦", gradient: "linear-gradient(135deg,#7a4a1e,#a4691f)" },
  { slug: "sets",   title: "Наборы",             short: "Наборы", emoji: "🏰", gradient: "linear-gradient(135deg,#1e5c3a,#7a6a1e)" }
];

function getCategory(slug) {
  return CATEGORIES.find(c => c.slug === slug);
}

// ---- Товары по умолчанию ----
// id: category-N — используется как ключ и не меняется при редактировании в админке
const DEFAULT_PRODUCTS = [
  // Marvel
  { id: "marvel-1", category: "marvel", name: "Железный человек Mark 85", price: 350, stock: 14, sku: "MRV-101", desc: "Минифигурка Железного человека в доспехе Mark 85, съёмный шлем." },
  { id: "marvel-2", category: "marvel", name: "Тор Одинсон", price: 320, stock: 9,  sku: "MRV-102", desc: "Тор с молотом Мьёльнир и плащом." },
  { id: "marvel-3", category: "marvel", name: "Танос с перчаткой бесконечности", price: 450, stock: 6,  sku: "MRV-103", desc: "Большая фигурка Таноса с камнями бесконечности." },
  { id: "marvel-4", category: "marvel", name: "Человек-паук (классический костюм)", price: 300, stock: 20, sku: "MRV-104", desc: "Классический красно-синий костюм, паутина в комплекте." },
  { id: "marvel-5", category: "marvel", name: "Локи", price: 310, stock: 11, sku: "MRV-105", desc: "Локи в золото-зелёном облачении со скипетром." },
  { id: "marvel-6", category: "marvel", name: "Капитан Америка", price: 330, stock: 13, sku: "MRV-106", desc: "Капитан Америка со щитом из вибраниума." },
  { id: "marvel-7", category: "marvel", name: "Веном", price: 400, stock: 7,  sku: "MRV-107", desc: "Фигурка Венома с эффектом симбиота." },

  // DC
  { id: "dc-1", category: "dc", name: "Бэтмен (тёмный рыцарь)", price: 340, stock: 15, sku: "DC-201", desc: "Бэтмен в чёрном костюме с плащом и бэтарангом." },
  { id: "dc-2", category: "dc", name: "Джокер", price: 360, stock: 8,  sku: "DC-202", desc: "Джокер в фиолетовом пиджаке, безумная улыбка." },
  { id: "dc-3", category: "dc", name: "Супермен", price: 320, stock: 12, sku: "DC-203", desc: "Супермен с плащом и символом S на груди." },
  { id: "dc-4", category: "dc", name: "Женщина-кошка", price: 310, stock: 10, sku: "DC-204", desc: "Женщина-кошка в чёрном костюме с хлыстом." },
  { id: "dc-5", category: "dc", name: "Флэш", price: 300, stock: 16, sku: "DC-205", desc: "Флэш в красном костюме, эффект скорости." },
  { id: "dc-6", category: "dc", name: "Аквамен", price: 320, stock: 9,  sku: "DC-206", desc: "Аквамен с трезубцем Атлантиды." },
  { id: "dc-7", category: "dc", name: "Харли Квинн", price: 350, stock: 11, sku: "DC-207", desc: "Харли Квинн с бейсбольной битой." },

  // Прочее
  { id: "other-1", category: "other", name: "Гарри Поттер", price: 280, stock: 18, sku: "OTH-301", desc: "Гарри Поттер в мантии Гриффиндора с палочкой." },
  { id: "other-2", category: "other", name: "Гэндальф", price: 300, stock: 10, sku: "OTH-302", desc: "Гэндальф Серый с посохом и шляпой." },
  { id: "other-3", category: "other", name: "Джек Воробей", price: 320, stock: 8,  sku: "OTH-303", desc: "Капитан Джек Воробей с саблей и компасом." },
  { id: "other-4", category: "other", name: "Ниндзя Кай", price: 260, stock: 14, sku: "OTH-304", desc: "Ниндзя Кай (Ninjago) в красном облачении." },
  { id: "other-5", category: "other", name: "Дарт Вейдер", price: 350, stock: 13, sku: "OTH-305", desc: "Дарт Вейдер со световым мечом." },
  { id: "other-6", category: "other", name: "Йода", price: 300, stock: 7,  sku: "OTH-306", desc: "Мастер Йода с миниатюрным световым мечом." },
  { id: "other-7", category: "other", name: "Рыцарь королевства", price: 250, stock: 15, sku: "OTH-307", desc: "Рыцарь в доспехах с мечом и щитом." },

  // Паки
  { id: "packs-1", category: "packs", name: "Пак «10 случайных фигурок Marvel»", price: 2200, stock: 5, sku: "PCK-401", desc: "10 случайных минифигурок вселенной Marvel." },
  { id: "packs-2", category: "packs", name: "Пак «10 случайных фигурок DC»", price: 2200, stock: 5, sku: "PCK-402", desc: "10 случайных минифигурок вселенной DC." },
  { id: "packs-3", category: "packs", name: "Пак «5 фигурок Star Wars»", price: 1300, stock: 6, sku: "PCK-403", desc: "5 случайных фигурок по вселенной Звёздных войн." },
  { id: "packs-4", category: "packs", name: "Пак «Микс 15 фигурок»", price: 3200, stock: 4, sku: "PCK-404", desc: "15 фигурок из разных серий — отличный старт коллекции." },
  { id: "packs-5", category: "packs", name: "Пак «Ninjago 8 фигурок»", price: 1800, stock: 7, sku: "PCK-405", desc: "8 случайных фигурок ниндзя из серии Ninjago." },
  { id: "packs-6", category: "packs", name: "Пак «Коллекционная серия», 12 фигурок", price: 2800, stock: 3, sku: "PCK-406", desc: "12 редких коллекционных фигурок в блайндбоксах." },

  // Наборы
  { id: "sets-1", category: "sets", name: "Набор «Битва за Готэм»", price: 1500, stock: 6, sku: "SET-501", desc: "3 фигурки + декорации города для сцены сражения." },
  { id: "sets-2", category: "sets", name: "Набор «Мстители: Финал»", price: 1900, stock: 5, sku: "SET-502", desc: "4 фигурки Мстителей с оружием и аксессуарами." },
  { id: "sets-3", category: "sets", name: "Набор «Пиратский корабль»", price: 2600, stock: 4, sku: "SET-503", desc: "3 фигурки пиратов и корабль в комплекте." },
  { id: "sets-4", category: "sets", name: "Набор «Замок Минас Тирит»", price: 3400, stock: 3, sku: "SET-504", desc: "5 фигурок и масштабная модель замка." },
  { id: "sets-5", category: "sets", name: "Набор «Храм ниндзя»", price: 2100, stock: 5, sku: "SET-505", desc: "4 фигурки ниндзя и храм с ловушками." },
  { id: "sets-6", category: "sets", name: "Набор «Дуэль джедаев»", price: 1200, stock: 8, sku: "SET-506", desc: "2 фигурки джедаев со световыми мечами." }
];

// ---- Товары приходят с сервера (см. папку /server), которым управляет Telegram-бот ----
// После деплоя сервера (например, на Railway) вставьте сюда его публичный адрес:
//   const API_BASE_URL = "https://your-app.up.railway.app";
// Пока адрес пустой — сайт работает в демо-режиме на встроенных данных выше.
const API_BASE_URL = "https://mostik-shop-production.up.railway.app";

let _products = DEFAULT_PRODUCTS.slice();

// Вызывается один раз в начале каждой страницы перед отрисовкой товаров.
async function initProducts() {
  if (API_BASE_URL) {
    try {
      const res = await fetch(API_BASE_URL + "/api/products");
      if (res.ok) {
        _products = await res.json();
        return _products;
      }
    } catch (e) {
      console.warn("Не удалось загрузить товары с сервера, используются встроенные данные.", e);
    }
  }
  _products = DEFAULT_PRODUCTS.slice();
  return _products;
}

// Синхронный доступ к уже загруженным товарам (после initProducts()).
function loadProducts() {
  return _products;
}

function getProductById(id) {
  return loadProducts().find(p => p.id === id);
}

function formatPrice(n) {
  return n.toLocaleString("ru-RU") + " ₽";
}
