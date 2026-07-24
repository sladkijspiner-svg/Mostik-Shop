require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const store = require("./store");
const flow = require("./telegramFlow");

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

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function denyAccess(chatId) {
  bot.sendMessage(chatId, "У вас нет доступа к управлению этим магазином.");
}

bot.onText(/^\/start/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) {
    bot.sendMessage(chatId, `Привет! Это бот магазина MINIFIG STORE.\nВаш Telegram id: ${msg.from.id}`);
    return;
  }
  bot.sendMessage(chatId, "Привет! Вы администратор магазина.\n\n" + flow.helpText());
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

bot.on("callback_query", query => {
  const chatId = query.message.chat.id;
  if (!isAdmin(query.from.id)) {
    bot.answerCallbackQuery(query.id);
    return denyAccess(chatId);
  }

  const data = query.data || "";
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

bot.on("message", msg => {
  // Пропускаем команды и сообщения без текста — их обрабатывают onText-хендлеры выше.
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;
  if (!isAdmin(msg.from.id)) return;

  const session = addSessions.get(chatId);
  if (!session || session.step === "category" || session.step === "done") return;

  const result = flow.handleAddStep(session, msg.text);
  if (result.error) {
    bot.sendMessage(chatId, result.error);
  } else if (result.done) {
    addSessions.delete(chatId);
    bot.sendMessage(chatId, `Товар добавлен ✅\n${flow.formatProductLine(result.product)}`);
  } else {
    bot.sendMessage(chatId, result.prompt);
  }
});

console.log("Telegram-бот запущен" + (ADMIN_IDS.length ? " для админов: " + ADMIN_IDS.join(", ") : ""));

module.exports = bot;
