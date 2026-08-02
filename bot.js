require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const store = require("./store");
const flow = require("./telegramFlow");
const herobloks = require("./herobloks");

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.warn("BOT_TOKEN не задан в переменных окружения — бот не запущен. API продолжает работать без него.");
  module.exports = null;
  return;
}

if (ADMIN_IDS.length === 0) {
  console.warn("ADMIN_IDS не задан — бот запущен, но никто не сможет управлять товарами. Укажите свой Telegram id.");
}

const bot = new TelegramBot(TOKEN, { polling: true });
bot.on("polling_error", err => console.error("polling_error:", err.message));

// chatId -> { step, data }
const addSessions = new Map();

// chatId -> true, если человек нажал «Найти фигурку» и бот ждёт от него
// артикул или название персонажа следующим сообщением.
const findSessions = new Map();

// chatId -> последний список образов/вариантов персонажа (первый уровень
// выбора, например «Ninja Strike Wolverine» / «Symbiote Wolverine»).
const lastGroups = new Map();

// chatId -> последний список конкретных фигурок на выбор (второй уровень —
// артикулы разных производителей одного и того же образа).
const lastResults = new Map();

// chatId -> последний список подсказок "Возможно, вы имели в виду?" —
// когда по запросу ничего не нашлось, но похоже на опечатку.
const lastSuggestions = new Map();

const FIND_BUTTON_TEXT = "🔍 Найти фигурку";
const WEBAPP_BUTTON_TEXT = "🖼 Найти с картинками";
const GROUP_PAGE_SIZE = 15;
// Адрес мини-приложения (Telegram WebApp) — та же страница, что и сайт
// магазина, только другой файл. Можно переопределить переменной окружения
// WEBAPP_URL, если адрес когда-нибудь изменится.
const WEBAPP_URL = process.env.WEBAPP_URL || "https://mostik-shop-production.up.railway.app/find-app.html";
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [FIND_BUTTON_TEXT],
      [{ text: WEBAPP_BUTTON_TEXT, web_app: { url: WEBAPP_URL } }]
    ],
    resize_keyboard: true
  }
};

// Кнопка мини-приложения, приклеенная прямо к сообщению (а не спрятана
// внизу в клавиатуре) — чтобы сразу после /start её было видно и можно было
// нажать в один тап.
const webAppInlineKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: WEBAPP_BUTTON_TEXT, web_app: { url: WEBAPP_URL } }]]
  }
};

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function denyAccess(chatId) {
  bot.sendMessage(chatId, "У вас нет доступа к управлению этим магазином.");
}

bot.onText(/^\/start/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) {
    bot.sendMessage(
      chatId,
      `Привет! Это бот магазина Mostik Shop.\nВаш Telegram id: ${msg.from.id}\n\nНажмите «${FIND_BUTTON_TEXT}» или просто напишите артикул фигурки (например PG-206) — пришлю фото и описание.`,
      mainKeyboard
    );
    bot.sendMessage(chatId, `Или сразу откройте каталог с фото — «${WEBAPP_BUTTON_TEXT}»:`, webAppInlineKeyboard);
    return;
  }
  bot.sendMessage(chatId, "Привет! Вы администратор магазина.\n\n" + flow.helpText(), mainKeyboard);
  bot.sendMessage(chatId, `Или сразу откройте каталог с фото — «${WEBAPP_BUTTON_TEXT}»:`, webAppInlineKeyboard);
});

bot.onText(/^\/help/, msg => {
  if (!isAdmin(msg.from.id)) return denyAccess(msg.chat.id);
  bot.sendMessage(msg.chat.id, flow.helpText());
});

bot.onText(/^\/cancel/, msg => {
  if (!isAdmin(msg.from.id)) return denyAccess(msg.chat.id);
  addSessions.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, "Добавление отменено.");
});

bot.onText(/^\/add\b/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return denyAccess(chatId);
  addSessions.set(chatId, flow.startAddSession());
  bot.sendMessage(chatId, "Выберите категорию:", { reply_markup: flow.categoryKeyboard() });
});

bot.onText(/^\/list\b\s*(\S*)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return denyAccess(chatId);
  const category = match[1] || null;
  const text = flow.formatProductList(store.loadProducts(), category || undefined);
  bot.sendMessage(chatId, text);
});

bot.onText(/^\/remove\b/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return denyAccess(chatId);
  const id = flow.parseIdArg(msg.text, "remove");
  if (!id) {
    bot.sendMessage(chatId, "Использование: /remove <id>\nId можно посмотреть через /list");
    return;
  }
  const removed = store.removeProduct(id);
  if (!removed) {
    bot.sendMessage(chatId, `Товар с id «${id}» не найден.`);
  } else {
    bot.sendMessage(chatId, `Удалено: ${removed.name}`);
  }
});

bot.onText(/^\/price\b/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return denyAccess(chatId);
  const args = flow.parseIdAndNumberArgs(msg.text, "price");
  if (!args || !Number.isFinite(args.value) || args.value <= 0) {
    bot.sendMessage(chatId, "Использование: /price <id> <новая цена>");
    return;
  }
  const updated = store.updateProduct(args.id, { price: args.value });
  bot.sendMessage(chatId, updated ? `Новая цена «${updated.name}»: ${flow.formatPrice(updated.price)}` : `Товар с id «${args.id}» не найден.`);
});

bot.onText(/^\/stock\b/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return denyAccess(chatId);
  const args = flow.parseIdAndNumberArgs(msg.text, "stock");
  if (!args || !Number.isInteger(args.value) || args.value < 0) {
    bot.sendMessage(chatId, "Использование: /stock <id> <новый остаток>");
    return;
  }
  const updated = store.updateProduct(args.id, { stock: args.value });
  bot.sendMessage(chatId, updated ? `Новый остаток «${updated.name}»: ${updated.stock}` : `Товар с id «${args.id}» не найден.`);
});

bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const data = query.data || "";

  // Кнопка «Ещё образы» — следующая страница списка образов персонажа.
  if (data.startsWith("fignext:")) {
    bot.answerCallbackQuery(query.id);
    const page = parseInt(data.slice("fignext:".length), 10) || 0;
    const groups = lastGroups.get(chatId);
    if (!groups) {
      bot.sendMessage(chatId, "Этот список уже устарел — начните поиск заново кнопкой «" + FIND_BUTTON_TEXT + "».");
      return;
    }
    const keyboard = buildGroupKeyboard(groups, page);
    const from = page * GROUP_PAGE_SIZE + 1;
    const to = Math.min((page + 1) * GROUP_PAGE_SIZE, groups.length);
    bot.sendMessage(chatId, `Образы ${from}–${to} из ${groups.length}:`, { reply_markup: keyboard });
    return;
  }

  // Выбор образа/варианта персонажа (первый уровень, например
  // «Ninja Strike Wolverine») — доступно любому пользователю.
  if (data.startsWith("figgroup:")) {
    bot.answerCallbackQuery(query.id);
    const idx = parseInt(data.slice("figgroup:".length), 10);
    const groups = lastGroups.get(chatId);
    if (!groups || !groups[idx]) {
      bot.sendMessage(chatId, "Этот список уже устарел — начните поиск заново кнопкой «" + FIND_BUTTON_TEXT + "».");
      return;
    }
    await presentItems(chatId, groups[idx].items);
    return;
  }

  // Кнопка «Ещё варианты» — следующая страница списка артикулов.
  if (data.startsWith("figpicknext:")) {
    bot.answerCallbackQuery(query.id);
    const page = parseInt(data.slice("figpicknext:".length), 10) || 0;
    const items = lastResults.get(chatId);
    if (!items) {
      bot.sendMessage(chatId, "Этот список уже устарел — начните поиск заново кнопкой «" + FIND_BUTTON_TEXT + "».");
      return;
    }
    const keyboard = buildItemKeyboard(items, page);
    const from = page * GROUP_PAGE_SIZE + 1;
    const to = Math.min((page + 1) * GROUP_PAGE_SIZE, items.length);
    bot.sendMessage(chatId, `Варианты ${from}–${to} из ${items.length}:`, { reply_markup: keyboard });
    return;
  }

  // Выбор конкретной фигурки (артикула) из списка — доступно любому пользователю.
  if (data.startsWith("figpick:")) {
    bot.answerCallbackQuery(query.id);
    const idx = parseInt(data.slice("figpick:".length), 10);
    const results = lastResults.get(chatId);
    if (!results || !results[idx]) {
      bot.sendMessage(chatId, "Этот список уже устарел — начните поиск заново кнопкой «" + FIND_BUTTON_TEXT + "».");
      return;
    }
    await sendFigures(chatId, [results[idx]]);
    return;
  }

  // Выбор подсказки "Возможно, вы имели в виду?" — запускает поиск заново
  // уже с исправленным вариантом.
  if (data.startsWith("figsug:")) {
    bot.answerCallbackQuery(query.id);
    const idx = parseInt(data.slice("figsug:".length), 10);
    const suggestions = lastSuggestions.get(chatId);
    if (!suggestions || !suggestions[idx]) {
      bot.sendMessage(chatId, "Эта подсказка уже устарела — начните поиск заново кнопкой «" + FIND_BUTTON_TEXT + "».");
      return;
    }
    await runFigureSearch(chatId, suggestions[idx].query);
    return;
  }

  if (!isAdmin(query.from.id)) {
    bot.answerCallbackQuery(query.id);
    return denyAccess(chatId);
  }

  if (data.startsWith("addcat:")) {
    const session = addSessions.get(chatId);
    if (!session) {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId, "Сессия добавления не активна. Начните заново командой /add.");
      return;
    }
    const slug = data.slice("addcat:".length);
    const result = flow.handleAddCategory(session, slug);
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId, result.error || result.prompt);
  }
});

bot.on("message", async msg => {
  // Сообщение из мини-приложения (человек выбрал фигурку на веб-странице) —
  // приходит без обычного текста, зато с полем web_app_data.
  if (msg.web_app_data) {
    await handleWebAppData(msg);
    return;
  }

  // Пропускаем команды и сообщения без текста — их обрабатывают onText-хендлеры выше.
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;

  // Если это админ и у него сейчас активен пошаговый /add — ведём его дальше по этому сценарию.
  if (isAdmin(msg.from.id)) {
    const session = addSessions.get(chatId);
    if (session && session.step !== "category" && session.step !== "done") {
      const result = flow.handleAddStep(session, msg.text);
      if (result.error) {
        bot.sendMessage(chatId, result.error);
      } else if (result.done) {
        addSessions.delete(chatId);
        bot.sendMessage(chatId, `Товар добавлен ✅\n${flow.formatProductLine(result.product)}`);
      } else {
        bot.sendMessage(chatId, result.prompt);
      }
      return;
    }
  }

  // Нажали кнопку «Найти фигурку» — включаем режим ожидания артикула/названия.
  if (msg.text.trim() === FIND_BUTTON_TEXT) {
    findSessions.set(chatId, true);
    bot.sendMessage(chatId, "Введите артикул фигурки (например PG-206) или название персонажа (например Wolverine или Росомаха):");
    return;
  }

  // Мы ждали от этого человека артикул/название после нажатия кнопки.
  if (findSessions.get(chatId)) {
    findSessions.delete(chatId);
    await runFigureSearch(chatId, msg.text.trim());
    return;
  }

  // Для всех остальных сообщений (от любого пользователя) — пробуем понять,
  // не написал ли человек код фигурки (PG206, pg-206, pogo 206, пг206 и т.п.)
  await handleFigureCodeLookup(msg);
});

// Обрабатывает выбор фигурки, сделанный в мини-приложении (find-app.html).
// Приложение присылает JSON вида {"href": "/figures/7400/pogo/pg-206/..."}
// через Telegram.WebApp.sendData() — забираем фото и описание и отправляем
// их обычным сообщением в чат, как если бы человек выбрал вариант в боте.
async function handleWebAppData(msg) {
  const chatId = msg.chat.id;
  try {
    const payload = JSON.parse(msg.web_app_data.data);
    if (payload && payload.href) {
      await sendFigures(chatId, [{ href: payload.href }]);
    }
  } catch (e) {
    console.error("web_app_data parse error:", e.message);
  }
}

// Ищет код фигурки в сообщении и, если находит совпадение в локальной базе
// herobloks.com, присылает пользователю фото и описание этой фигурки.
async function handleFigureCodeLookup(msg) {
  const matches = herobloks.findFigureMatches(msg.text);
  if (matches.length === 0) return;
  await sendFigures(msg.chat.id, matches);
}

// Обрабатывает запрос из режима «Найти фигурку»: сначала пробует как артикул,
// если не нашлось — ищет по названию персонажа (в т.ч. по паре русских имён).
// Поиск по названию — двухуровневый: сперва показываем список образов
// («Wolverine», «Ninja Strike Wolverine», «Symbiote Wolverine» и т.п.),
// а после выбора образа — список конкретных артикулов разных производителей.
// Если совсем ничего не нашлось — пробует угадать опечатку и предлагает
// варианты кнопками «Возможно, вы имели в виду?».
async function runFigureSearch(chatId, text) {
  const codeMatches = herobloks.findFigureMatches(text);
  if (codeMatches.length > 0) {
    await sendFigures(chatId, codeMatches);
    return;
  }

  const nameMatches = herobloks.findFigureByName(text);
  if (nameMatches.length === 0) {
    const suggestions = herobloks.suggestNames(text);
    if (suggestions.length > 0) {
      lastSuggestions.set(chatId, suggestions);
      const rows = suggestions.map((s, i) => [{ text: s.label, callback_data: "figsug:" + i }]);
      bot.sendMessage(chatId, "Ничего не нашлось. Возможно, вы имели в виду:", { reply_markup: { inline_keyboard: rows } });
    } else {
      bot.sendMessage(chatId, "Ничего не нашлось. Попробуйте другой артикул или название (можно по-английски).");
    }
    return;
  }

  const groups = herobloks.groupFiguresByName(nameMatches);

  if (groups.length === 1) {
    await presentItems(chatId, groups[0].items);
    return;
  }

  lastGroups.set(chatId, groups);
  const keyboard = buildGroupKeyboard(groups, 0);
  bot.sendMessage(chatId, `Нашлось несколько образов (${groups.length}) — выберите нужный:`, { reply_markup: keyboard });
}

// Строит клавиатуру для одной "страницы" списка образов персонажа
// (не более GROUP_PAGE_SIZE кнопок за раз) с кнопкой «Ещё образы», если
// дальше есть ещё варианты.
function buildGroupKeyboard(groups, page) {
  const start = page * GROUP_PAGE_SIZE;
  const pageGroups = groups.slice(start, start + GROUP_PAGE_SIZE);
  const rows = pageGroups.map((g, i) => [{ text: `${g.name} (${g.items.length})`, callback_data: "figgroup:" + (start + i) }]);
  if (start + GROUP_PAGE_SIZE < groups.length) {
    rows.push([{ text: "➡️ Ещё образы", callback_data: "fignext:" + (page + 1) }]);
  }
  return { inline_keyboard: rows };
}

// Показывает конкретные фигурки: если она одна — сразу присылает фото,
// если несколько (разные производители одного образа) — список на выбор
// (тоже постранично, если вариантов много).
async function presentItems(chatId, items) {
  if (items.length === 1) {
    await sendFigures(chatId, items);
    return;
  }
  lastResults.set(chatId, items);
  const keyboard = buildItemKeyboard(items, 0);
  bot.sendMessage(chatId, `Нашлось ${items.length} вариантов — выберите нужный:`, { reply_markup: keyboard });
}

function buildItemKeyboard(items, page) {
  const start = page * GROUP_PAGE_SIZE;
  const pageItems = items.slice(start, start + GROUP_PAGE_SIZE);
  const rows = pageItems.map((item, i) => [{ text: item.label || item.name, callback_data: "figpick:" + (start + i) }]);
  if (start + GROUP_PAGE_SIZE < items.length) {
    rows.push([{ text: "➡️ Ещё варианты", callback_data: "figpicknext:" + (page + 1) }]);
  }
  return { inline_keyboard: rows };
}

// Забирает описание и фото фигурки(ок) с herobloks.com и отправляет в чат.
// Если у фигурки несколько фото — присылает их все альбомом.
async function sendFigures(chatId, matches) {
  for (const match of matches) {
    const href = match.href || match.h;
    try {
      const details = await herobloks.fetchFigureDetails(href);
      const lines = [];
      lines.push(`🧱 ${details.name || details.basename || "Фигурка"}`);
      if (details.brand || details.serial) {
        lines.push(`${details.brand || ""} ${details.serial || ""}`.trim());
      }
      if (details.year) lines.push(`Год: ${details.year}`);
      if (details.theme) lines.push(`Тема: ${details.theme}`);
      lines.push(`Подробнее: ${details.pageUrl}`);
      const caption = lines.join("\n");

      const photos = details.imageUrls && details.imageUrls.length ? details.imageUrls : (details.imageUrl ? [details.imageUrl] : []);

      if (photos.length > 1) {
        const media = photos.slice(0, 10).map((url, i) => ({
          type: "photo",
          media: url,
          caption: i === 0 ? caption : undefined
        }));
        await bot.sendMediaGroup(chatId, media);
      } else if (photos.length === 1) {
        await bot.sendPhoto(chatId, photos[0], { caption });
      } else {
        await bot.sendMessage(chatId, caption);
      }
    } catch (e) {
      console.error("herobloks lookup error:", e.message);
    }
  }
}

console.log("Telegram-бот запущен" + (ADMIN_IDS.length ? " для админов: " + ADMIN_IDS.join(", ") : ""));

module.exports = bot;
