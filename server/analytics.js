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
//
// ВАЖНО про память: на маленьком тарифе Railway процесс один раз уже падал
// по нехватке памяти прямо посреди такого обхода (см. историю в index.js —
// автозапуск при старте сервера поэтому отключён). Чтобы одно случайное
// падение не откатывало прогресс к нулю, промежуточный результат сохраняется
// на диск (data/analytics_checkpoint.json) каждые CHECKPOINT_EVERY фигурок —
// если процесс упадёт и /rebuildstats запустят заново, обход продолжится с
// того места, где остановился, а не с начала. Плюс в памяти держим не весь
// список (~6500 объектов), а только то, что реально нужно в конце — топ-15
// популярных, топ-15 редких и счётчик по годам.

const fs = require("fs");
const path = require("path");
const herobloks = require("./herobloks");

const CACHE_FILE = path.join(__dirname, "data", "analytics.json");
const CHECKPOINT_FILE = path.join(__dirname, "data", "analytics_checkpoint.json");
const REBUILD_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // сами по себе пересобираем не чаще раза в 30 дней
const CONCURRENCY = 2; // ниже, чем раньше — на маленьком тарифе Railway сборка
// на всю базу (~6500+ фигурок) при параллельности 6 упирается в лимит памяти
// контейнера и роняет весь процесс ещё до того, как соберётся даже 1/20 базы.
// При параллельности 2 нагрузка на память и на herobloks.com ощутимо меньше,
// а сама сборка просто идёт дольше.
const CHECKPOINT_EVERY = 100; // сохранять прогресс на диск каждые N фигурок
const MAX_TOP = 15;

let building = false;
let cache = loadJson(CACHE_FILE);

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data), "utf8");
  } catch (e) {
    console.error(`analytics: не удалось сохранить ${path.basename(file)} на диск:`, e.message);
  }
}

function getCached() {
  return cache;
}

function isBuilding() {
  return building;
}

// Держит только MAX_TOP лучших элементов по cmp — не нужно хранить в памяти
// весь список фигурок, чтобы в конце найти топ-15.
function insertTop(list, item, cmp) {
  list.push(item);
  list.sort(cmp);
  if (list.length > MAX_TOP) list.length = MAX_TOP;
}

/**
 * Обходит всю базу фигурок и пересчитывает статистику. onProgress(done, total)
 * вызывается время от времени, чтобы можно было показать прогресс (например
 * в чате бота). Возвращает готовый объект статистики (и заодно сохраняет его
 * в кэш и на диск). Если предыдущий запуск был прерван (падение процесса),
 * продолжает с сохранённого чекпоинта, а не с начала.
 */
async function buildAnalytics(onProgress) {
  if (building) return cache;
  building = true;
  try {
    const list = herobloks.getAllFigures(); // [{href, brand, serial, name}]

    let checkpoint = loadJson(CHECKPOINT_FILE);
    if (!checkpoint || checkpoint.total !== list.length) {
      checkpoint = { cursor: 0, total: list.length, mostOwned: [], rare: [], yearCounts: {} };
    }

    let cursor = checkpoint.cursor;
    const mostOwned = checkpoint.mostOwned;
    const rare = checkpoint.rare;
    const yearCounts = checkpoint.yearCounts;

    if (onProgress && cursor > 0) onProgress(cursor, list.length);

    while (cursor < list.length) {
      const batchEnd = Math.min(cursor + CONCURRENCY, list.length);
      const batch = [];
      for (let i = cursor; i < batchEnd; i++) batch.push(list[i]);

      await Promise.all(batch.map(async item => {
        try {
          const details = await herobloks.fetchFigureDetails(item.href);
          const year = details.year ? parseInt(details.year, 10) : null;
          const owners = typeof details.owners === "number" ? details.owners : 0;
          const rec = {
            href: item.href,
            name: details.name || item.name,
            brand: details.brand || item.brand,
            serial: details.serial || item.serial,
            year: Number.isFinite(year) ? year : null,
            owners,
            imageUrl: details.imageUrl || null
          };
          if (owners > 0) {
            insertTop(mostOwned, rec, (a, b) => b.owners - a.owners);
            insertTop(rare, rec, (a, b) => a.owners - b.owners);
          }
          if (rec.year) yearCounts[rec.year] = (yearCounts[rec.year] || 0) + 1;
        } catch (e) {
          // Пропускаем — одна неудачная фигурка не должна ронять весь обход.
        }
      }));

      cursor = batchEnd;

      if (cursor % CHECKPOINT_EVERY < CONCURRENCY || cursor === list.length) {
        saveJson(CHECKPOINT_FILE, { cursor, total: list.length, mostOwned, rare, yearCounts });
      }
      if (onProgress && (cursor % 250 < CONCURRENCY || cursor === list.length)) {
        onProgress(cursor, list.length);
      }
    }

    const byYear = Object.keys(yearCounts)
      .map(year => ({ year: parseInt(year, 10), count: yearCounts[year] }))
      .sort((a, b) => a.year - b.year);

    const data = {
      builtAt: new Date().toISOString(),
      totalFigures: list.length,
      mostOwned,
      rare,
      byYear
    };
    cache = data;
    saveJson(CACHE_FILE, data);
    try { fs.unlinkSync(CHECKPOINT_FILE); } catch (e) {}
    return data;
  } finally {
    building = false;
  }
}

// При старте сервера — если статистики ещё нет или она давно не обновлялась,
// запускаем пересчёт в фоне (не блокируя работу остального API). Сейчас этот
// автозапуск отключён в index.js (см. комментарий там) — статистика считается
// только вручную командой /rebuildstats.
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
