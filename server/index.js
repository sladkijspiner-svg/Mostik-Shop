require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
// Готовит "живые" данные (товары/вишлисты/архивы статистики) в data/state/ —
// папке на постоянном диске Railway, которая не сбрасывается деплоями (см.
// подробное объяснение в bootstrap.js). Должно выполниться раньше, чем
// store/wishlist/analytics впервые попробуют прочитать свои файлы.
require("./bootstrap").run();
const store = require("./store");
const herobloks = require("./herobloks");
const wishlist = require("./wishlist");
const analytics = require("./analytics");
// Бот стартует прямо при этом require (тот же процесс, чтобы не поднимать
// второй сервис) — переменная нужна, чтобы отсюда тоже можно было слать
// сообщения администратору (например вишлист из мини-приложения).
const bot = require("./bot");

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors());
app.use(express.json());

// Клиент Telegram (особенно Desktop) агрессивно кэширует HTML/JS мини-приложений
// у себя в WebView — своим собственным кэшем поверх обычного HTTP, из-за чего
// человек может подолгу видеть старую версию страницы даже после того, как на
// сервере уже давно лежит исправленная. Явно запрещаем кэширование для .html,
// чтобы каждое открытие мини-приложения гарантированно подтягивало свежий файл.
app.use((req, res, next) => {
  if (req.path.endsWith(".html")) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

// Сам сайт (index.html, каталог, корзина и т.д.) лежит в папке public/
// и отдаётся с того же адреса, что и API — так у магазина одна ссылка.
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/products", (req, res) => {
  res.json(store.loadProducts());
});

app.get("/api/products/:id", (req, res) => {
  const product = store.findProduct(req.params.id);
  if (!product) return res.status(404).json({ error: "not_found" });
  res.json(product);
});

app.get("/api/categories", (req, res) => {
  res.json(store.getCategories());
});

// ---- API для мини-приложения «Найти фигурку» (Telegram WebApp) ----
// Та же база и та же логика поиска, что и в самом боте (server/herobloks.js),
// просто доступна через HTTP, чтобы веб-страница внутри Telegram могла её
// вызывать и показывать результаты с картинками (в кнопках бота Telegram
// картинки показать нельзя, а на веб-странице — можно).

app.get("/api/herobloks/search", (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ codeMatches: [], groups: [] });

  const codeMatches = herobloks.findFigureMatches(q).map(m => ({
    href: m.h,
    brand: m.b,
    serial: m.s
  }));

  const nameMatches = herobloks.findFigureByName(q);
  const groups = herobloks.groupFiguresByName(nameMatches).map(g => ({
    name: g.name,
    items: g.items.map(it => ({ href: it.href, brand: it.brand, serial: it.serial, label: it.label }))
  }));

  // Если совсем ничего не нашлось — пробуем угадать опечатку и подсказать.
  const suggestions = (codeMatches.length === 0 && groups.length === 0)
    ? herobloks.suggestNames(q)
    : [];

  res.json({ codeMatches, groups, suggestions });
});

// Забирает фото+название для набора конкретных фигурок (по ссылкам) —
// используется, чтобы показать миниатюры в списке вариантов. Запросы к
// herobloks.com идут с ограниченной параллельностью, чтобы не перегружать
// их сайт.
async function fetchWithConcurrency(hrefs, limit) {
  const results = new Array(hrefs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < hrefs.length) {
      const i = cursor++;
      try {
        const details = await herobloks.fetchFigureDetails(hrefs[i]);
        results[i] = {
          href: hrefs[i],
          name: details.name,
          imageUrl: details.imageUrl
        };
      } catch (e) {
        results[i] = { href: hrefs[i], name: null, imageUrl: null, error: true };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, hrefs.length) }, worker);
  await Promise.all(workers);
  return results;
}

app.post("/api/herobloks/thumbnails", async (req, res) => {
  const hrefs = Array.isArray(req.body.hrefs) ? req.body.hrefs.slice(0, 30) : [];
  if (hrefs.length === 0) return res.json({ items: [] });
  try {
    const items = await fetchWithConcurrency(hrefs, 8);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: "fetch_failed" });
  }
});

app.get("/api/herobloks/details", async (req, res) => {
  const href = (req.query.href || "").toString();
  if (!href || !href.startsWith("/figures/")) return res.status(400).json({ error: "bad_href" });
  try {
    const details = await herobloks.fetchFigureDetails(href);
    const marketplaceCode = herobloks.marketplaceQuery(href, details.serial || "");
    res.json({ ...details, marketplaceCode });
  } catch (e) {
    res.status(500).json({ error: "fetch_failed" });
  }
});

// ---- API вишлиста (для мини-приложения) ----
// Тот же вишлист, что и в самом боте (команда /wishlist) — общее хранилище
// server/data/wishlists.json, ключ — Telegram id покупателя.

app.get("/api/wishlist", (req, res) => {
  const userId = (req.query.userId || "").toString();
  if (!userId) return res.status(400).json({ error: "no_user" });
  res.json({ items: wishlist.getList(userId) });
});

app.post("/api/wishlist/add", (req, res) => {
  const userId = (req.body.userId || "").toString();
  const href = (req.body.href || "").toString();
  if (!userId || !href) return res.status(400).json({ error: "bad_request" });
  const items = wishlist.addItem(userId, {
    href,
    name: req.body.name,
    brand: req.body.brand,
    serial: req.body.serial
  });
  res.json({ items });
});

app.post("/api/wishlist/remove", (req, res) => {
  const userId = (req.body.userId || "").toString();
  const href = (req.body.href || "").toString();
  if (!userId || !href) return res.status(400).json({ error: "bad_request" });
  const items = wishlist.removeItem(userId, href);
  res.json({ items });
});

app.post("/api/wishlist/clear", (req, res) => {
  const userId = (req.body.userId || "").toString();
  if (!userId) return res.status(400).json({ error: "bad_request" });
  wishlist.clearList(userId);
  res.json({ items: [] });
});

// Отправляет вишлист покупателя администратору магазина в чат бота — чтобы
// он мог поискать эти фигурки в продаже.
app.post("/api/wishlist/send", async (req, res) => {
  const userId = (req.body.userId || "").toString();
  if (!userId) return res.status(400).json({ error: "bad_request" });

  const list = wishlist.getList(userId);
  if (list.length === 0) return res.json({ ok: false, reason: "empty" });
  if (!bot || ADMIN_IDS.length === 0) return res.json({ ok: false, reason: "no_admin" });

  const who = req.body.username ? "@" + req.body.username : (req.body.firstName || "Покупатель");
  const text = wishlist.formatWishlistText(who, userId, list);
  for (const adminId of ADMIN_IDS) {
    bot.sendMessage(adminId, text).catch(e => console.error("wishlist send error:", e.message));
  }
  res.json({ ok: true });
});

// ---- Аналитика по фигуркам (для главного экрана мини-приложения) ----
// Два независимых источника:
//   1. wishlistTop — что хотят купить НАШИ покупатели (считается мгновенно
//      по своему же файлу data/wishlists.json, без обращений к herobloks.com).
//   2. topOwners / byYear — мировая статистика с herobloks.com ("Зал славы
//      коллекционеров" и разбивка по годам), собирается раз в месяц и
//      архивируется по месяцам (см. server/analytics.js) — тут просто
//      отдаём самый свежий готовый архив, плюс флаг "идёт сбор", если обход
//      всей базы ещё не закончился.
app.get("/api/herobloks/analytics", (req, res) => {
  const data = analytics.getCached();
  const wishlistTop = wishlist.getPopularInWishlists(20);
  res.json({
    ready: !!data,
    building: analytics.isBuilding(),
    wishlistTop,
    ...(data || {})
  });
});

// Временный служебный эндпоинт — просто чтобы можно было посмотреть прогресс
// сборки статистики (сколько фигурок уже обработано) без доступа к консоли
// сервера. Ничего не меняет, только читает файл чекпоинта с диска.
app.get("/api/admin/checkpoint", (req, res) => {
  try {
    const fs = require("fs");
    const cpPath = path.join(__dirname, "data", "state", "analytics_checkpoint.json");
    if (!fs.existsSync(cpPath)) return res.json({ exists: false });
    const cp = JSON.parse(fs.readFileSync(cpPath, "utf8"));
    res.json({ exists: true, month: cp.month, cursor: cp.cursor, total: cp.total });
  } catch (e) {
    res.json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API запущено на порту " + PORT);

  // Автопродолжение прерванной падением сборки статистики — safety-capped
  // версия автозапуска (см. подробности в analytics.js/maybeAutoResumeBuild):
  // в отличие от старого безусловного автозапуска ниже (который уронил весь
  // сайт), эта функция НЕ начинает сборку сама с нуля — только аккуратно
  // продолжает то, что уже было один раз запущено вручную командой
  // /rebuildstats и прервалось падением, и не больше нескольких раз подряд,
  // прежде чем сдаться и попросить вмешаться вручную. Задержка в 30 секунд —
  // чтобы сначала сервер точно поднялся и начал нормально отвечать на обычные
  // запросы, и только потом (если нужно) подключать тяжёлую фоновую работу.
  setTimeout(() => {
    analytics.maybeAutoResumeBuild(text => {
      if (bot && ADMIN_IDS.length) {
        ADMIN_IDS.forEach(id => bot.sendMessage(id, text).catch(() => {}));
      }
    });
  }, 30000);

  // ВАЖНО: безусловный автозапуск при КАЖДОМ старте сервера был отключён —
  // сборка мировой статистики упирается в лимит памяти этого тарифа Railway и
  // регулярно падала по Out Of Memory. Прогресс сохраняется на диск (см.
  // server/analytics.js), поэтому сами падения не страшны — НО у Railway
  // есть лимит на число автоматических перезапусков подряд (10 на этом
  // тарифе), и когда сборка падает так же часто, как здесь, этот лимит
  // исчерпывается за 10-15 минут — после чего Railway перестаёт пытаться
  // перезапустить контейнер сам, и падает уже ВЕСЬ сайт (не только
  // статистика), пока кто-то не перезапустит его вручную. Именно это и
  // произошло. Поэтому сборку теперь запускаем только вручную командой бота
  // /rebuildstats — так админ сам решает, когда её включить, и может
  // приглядывать за тем, не упирается ли она в лимит перезапусков.
  // analytics.maybeAutoBuildMonthly();
});
