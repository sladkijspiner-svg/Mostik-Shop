// Чистая логика диалога с ботом — без зависимости от Telegram API.
// Это позволяет протестировать её обычными юнит-тестами (node) без сети.

const store = require("./store");

function formatPrice(n) {
  return Number(n).toLocaleString("ru-RU") + " ₽";
}

function helpText() {
  return [
    "Доступные команды:",
    "/add — добавить новую фигурку (пошагово)",
    "/list — список всех товаров",
    "/list <категория> — список по категории (marvel, dc, other, packs, sets)",
    "/remove <id> — удалить товар по id",
    "/price <id> <цена> — изменить цену",
    "/stock <id> <остаток> — изменить остаток",
    "/cancel — отменить текущее добавление"
  ].join("\n");
}

function formatProductLine(p) {
  return `${p.id} — ${p.name} · ${formatPrice(p.price)} · остаток ${p.stock}`;
}

function formatProductList(products, categorySlug) {
  let list = products;
  if (categorySlug) {
    list = list.filter(p => p.category === categorySlug);
  }
  if (list.length === 0) {
    return categorySlug ? `В категории «${categorySlug}» товаров нет.` : "Товаров пока нет.";
  }
  return list.map(formatProductLine).join("\n");
}

function categoryKeyboard() {
  const cats = store.getCategories();
  return {
    inline_keyboard: cats.map(c => [{ text: c.title, callback_data: "addcat:" + c.slug }])
  };
}

// ---- Пошаговое добавление товара ----
// session: { step: "category"|"name"|"price"|"stock"|"desc", data: {...} }

function startAddSession() {
  return { step: "category", data: {} };
}

function handleAddCategory(session, categorySlug) {
  if (!store.isValidCategory(categorySlug)) {
    return { error: "Неизвестная категория." };
  }
  session.data.category = categorySlug;
  session.step = "name";
  return { prompt: "Введите название фигурки:" };
}

function handleAddStep(session, text) {
  text = (text || "").trim();

  if (session.step === "name") {
    if (!text) return { error: "Название не может быть пустым. Введите название фигурки:" };
    session.data.name = text;
    session.step = "price";
    return { prompt: "Введите цену в рублях (только число):" };
  }

  if (session.step === "price") {
    const price = Number(text.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      return { error: "Цена должна быть положительным числом. Введите цену ещё раз:" };
    }
    session.data.price = price;
    session.step = "stock";
    return { prompt: "Введите количество на складе (только число):" };
  }

  if (session.step === "stock") {
    const stock = Number(text);
    if (!Number.isInteger(stock) || stock < 0) {
      return { error: "Остаток должен быть целым неотрицательным числом. Введите ещё раз:" };
    }
    session.data.stock = stock;
    session.step = "desc";
    return { prompt: "Добавьте краткое описание (или отправьте «-», чтобы пропустить):" };
  }

  if (session.step === "desc") {
    session.data.desc = text === "-" ? "" : text;
    const product = store.addProduct(session.data);
    session.step = "done";
    return { done: true, product };
  }

  return { error: "Сессия добавления не активна. Начните заново командой /add." };
}

function parseIdArg(text, command) {
  const match = text.trim().match(new RegExp("^/" + command + "\\s+(\\S+)"));
  return match ? match[1] : null;
}

function parseIdAndNumberArgs(text, command) {
  const match = text.trim().match(new RegExp("^/" + command + "\\s+(\\S+)\\s+(\\S+)"));
  if (!match) return null;
  return { id: match[1], value: Number(match[2].replace(",", ".")) };
}

module.exports = {
  formatPrice,
  helpText,
  formatProductLine,
  formatProductList,
  categoryKeyboard,
  startAddSession,
  handleAddCategory,
  handleAddStep,
  parseIdArg,
  parseIdAndNumberArgs
};
