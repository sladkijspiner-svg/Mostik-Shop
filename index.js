require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const store = require("./store");
const herobloks = require("./herobloks");

const app = express();
app.use(cors());
app.use(express.json());

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

  res.json({ codeMatches, groups });
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
    const items = await fetchWithConcurrency(hrefs, 5);
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
    res.json(details);
  } catch (e) {
    res.status(500).json({ error: "fetch_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API запущено на порту " + PORT);
});

// Бот запускается в этом же процессе, чтобы не поднимать второй сервис.
require("./bot");
