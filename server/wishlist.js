// Вишлист покупателей: каждый пользователь может отметить фигурки, которые
// хочет купить, а потом одной кнопкой отправить список администратору
// магазина, чтобы тот поискал их в продаже. Хранится в простом JSON-файле —
// так же, как товары в store.js. Файл лежит в data/state/ (постоянный диск
// Railway, не сбрасывается деплоями — см. server/bootstrap.js).

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data", "state", "wishlists.json");

function loadAll() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveAll(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Список фигурок пользователя (по его Telegram id).
function getList(userId) {
  const all = loadAll();
  return all[String(userId)] || [];
}

// Добавляет фигурку в вишлист (без дублей по ссылке). Возвращает весь
// обновлённый список.
function addItem(userId, item) {
  const all = loadAll();
  const key = String(userId);
  const list = all[key] || [];
  if (list.some(x => x.href === item.href)) return list;
  list.push({
    href: item.href,
    name: item.name || null,
    brand: item.brand || null,
    serial: item.serial || null,
    addedAt: new Date().toISOString()
  });
  all[key] = list;
  saveAll(all);
  return list;
}

// Убирает фигурку из вишлиста по ссылке. Возвращает обновлённый список.
function removeItem(userId, href) {
  const all = loadAll();
  const key = String(userId);
  const list = (all[key] || []).filter(x => x.href !== href);
  all[key] = list;
  saveAll(all);
  return list;
}

function clearList(userId) {
  const all = loadAll();
  all[String(userId)] = [];
  saveAll(all);
}

// Текст сообщения для администратора со списком фигурок из вишлиста.
function formatWishlistText(who, userId, list) {
  const lines = list.map((item, i) => {
    const bits = [`${i + 1}. ${item.name || "Фигурка"}`];
    const brandSerial = `${item.brand || ""} ${item.serial || ""}`.trim();
    if (brandSerial) bits.push(`— ${brandSerial}`);
    let line = bits.join(" ");
    if (item.href) line += `\nhttps://www.herobloks.com${item.href}`;
    return line;
  });
  return `📩 Вишлист от ${who} (id ${userId}):\n\n` + lines.join("\n\n");
}

// Считает, сколько раз каждая фигурка встречается в вишлистах ВСЕХ
// покупателей нашего магазина — в отличие от статистики с herobloks.com,
// тут вообще не нужно никуда ходить: считаем прямо по своему же файлу
// data/wishlists.json, мгновенно и без риска для памяти сервера.
// Используется для раздела главного экрана мини-приложения "хотят у нас".
function getPopularInWishlists(limit) {
  const all = loadAll();
  const byHref = new Map(); // href -> { href, name, brand, serial, count }

  for (const userId of Object.keys(all)) {
    for (const item of all[userId] || []) {
      if (!item || !item.href) continue;
      const existing = byHref.get(item.href);
      if (existing) {
        existing.count++;
      } else {
        byHref.set(item.href, {
          href: item.href,
          name: item.name || null,
          brand: item.brand || null,
          serial: item.serial || null,
          count: 1
        });
      }
    }
  }

  return Array.from(byHref.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit || 20);
}

module.exports = { getList, addItem, removeItem, clearList, formatWishlistText, getPopularInWishlists };
