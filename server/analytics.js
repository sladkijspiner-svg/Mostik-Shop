// ---- Аналитика по фигуркам: "у кого сколько" и "в каком году выпускалось больше всего" ----
//
// На каждой странице фигурки herobloks.com внизу показывает, сколько людей
// отметили её у себя в коллекции ("N users own this figure"), а в карточке
// есть год выпуска (Year). Эти же данные забирает herobloks.fetchFigureDetails
// для обычного показа карточки — здесь просто проходимся по ВСЕЙ базе целиком
// (все ~6500+ фигурок из data/herobloks_index.json) и считаем:
//   - какие фигурки много у кого есть (популярные),
//   - какие почти ни у кого нет (редкие),
//   - сколько фигурок выходило в каждом году.
//
// Обход всей базы — не быстрая операция (несколько минут, т.к. нужно сходить
// на herobloks.com за каждой фигуркой по очереди с ограниченной
// параллельностью, чтобы не перегружать их сайт), поэтому результат
// считается не на каждый запрос, а один раз в фоне и сохраняется в файл
// data/analytics.json. Пересобрать можно вручную командой бота /rebuildstats
// (только для админа) — например, если через какое-то время захочется
// свежие цифры.

const fs = require("fs");
const path = require("path");
const herobloks = require("./herobloks");

const CACHE_FILE = path.join(__dirname, "data", "analytics.json");
const REBUILD_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // сами по себе пересобираем не чаще раза в 30 дней
const CONCURRENCY = 2; // ниже, чем раньше — на маленьком тарифе Railway сборка
// на всю базу (~6500+ фигурок) при параллельности 6 упирается в лимит памяти
// контейнера и роняет весь процесс (см. комментарий в index.js) ещё до того,
// как соберётся даже 1/20 базы. При параллельности 2 нагрузка на память и на
// herobloks.com ощутимо меньше, а сама сборка просто идёт дольше.

let building = false;
let cache = loadFromDisk();

function loadFromDisk() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (e) {
    return null;
  }
}

function saveToDisk(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("analytics: не удалось сохранить кэш на диск:", e.message);
  }
}

function getCached() {
  return cache;
}

function isBuilding() {
  return building;
}

async function fetchWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
}

/**
 * Обходит всю базу фигурок и пересчитывает статистику. onProgress(done, total)
 * вызывается время от времени, чтобы можно было показать прогресс (например
 * в чате бота). Возвращает готовый объект статистики (и заодно сохраняет его
 * в кэш и на диск).
 */
async function buildAnalytics(onProgress) {
  if (building) return cache;
  building = true;
  try {
    const list = herobloks.getAllFigures(); // [{href, brand, serial, name}]
    const results = new Array(list.length).fill(null);
    let done = 0;

    await fetchWithConcurrency(list, CONCURRENCY, async (item, i) => {
      try {
        const details = await herobloks.fetchFigureDetails(item.href);
        const year = details.year ? parseInt(details.year, 10) : null;
        results[i] = {
          href: item.href,
          name: details.name || item.name,
          brand: details.brand || item.brand,
          serial: details.serial || item.serial,
          year: Number.isFinite(year) ? year : null,
          owners: typeof details.owners === "number" ? details.owners : 0,
          imageUrl: details.imageUrl || null
        };
      } catch (e) {
        results[i] = null;
      }
      done++;
      if (onProgress && done % 250 === 0) onProgress(done, list.length);
    });

    const valid = results.filter(Boolean);

    const mostOwned = valid
      .filter(f => f.owners > 0)
      .sort((a, b) => b.owners - a.owners)
      .slice(0, 15);

    const rare = valid
      .filter(f => f.owners > 0)
      .sort((a, b) => a.owners - b.owners)
      .slice(0, 15);

    const yearCounts = new Map();
    for (const f of valid) {
      if (!f.year) continue;
      yearCounts.set(f.year, (yearCounts.get(f.year) || 0) + 1);
    }
    const byYear = Array.from(yearCounts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year);

    const data = {
      builtAt: new Date().toISOString(),
      totalFigures: valid.length,
      mostOwned,
      rare,
      byYear
    };
    cache = data;
    saveToDisk(data);
    if (onProgress) onProgress(list.length, list.length);
    return data;
  } finally {
    building = false;
  }
}

// При старте сервера — если статистики ещё нет или она давно не обновлялась,
// запускаем пересчёт в фоне (не блокируя работу остального API).
function maybeAutoBuild() {
  const stale = !cache || (Date.now() - new Date(cache.builtAt).getTime() > REBUILD_AFTER_MS);
  if (stale && !building) {
    console.log("analytics: запускаю фоновый пересчёт статистики по фигуркам (может занять несколько минут)...");
    buildAnalytics((done, total) => console.log(`analytics: обработано ${done}/${total}`))
      .then(() => console.log("analytics: статистика готова"))
      .catch(e => console.error("analytics: ошибка при сборе статистики:", e.message));
  }
}

module.exports = { getCached, isBuilding, buildAnalytics, maybeAutoBuild };
