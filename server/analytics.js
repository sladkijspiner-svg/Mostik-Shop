// ---- Мировая статистика по фигуркам: "Зал славы коллекционеров" и разбивка по годам ----
//
// На каждой странице фигурки herobloks.com внизу показывает, сколько людей
// по всему миру отметили её у себя в коллекции ("N users own this figure"),
// а в карточке есть год выпуска (Year). Эти же данные забирает
// herobloks.fetchFigureDetails для обычного показа карточки — здесь
// проходимся по ВСЕЙ базе целиком (все ~6500+ фигурок из
// data/herobloks_index.json) и считаем:
//   - топ-20 самых популярных у мировых коллекционеров ("Зал славы"),
//   - сколько фигурок выходило в каждом году (учитываются только фигурки
//     до 2021 года — по последним годам данные на herobloks.com ещё не
//     устоялись).
//
// Обход всей базы — не быстрая операция (несколько минут, т.к. нужно сходить
// на herobloks.com за каждой фигуркой по очереди с ограниченной
// параллельностью, чтобы не перегружать их сайт и не упереться в память на
// маленьком тарифе Railway — см. историю в index.js), поэтому результат
// считается не на каждый запрос, а раз в месяц и складывается в архив —
// каждый месяц отдельный файл data/analytics_archive/YYYY-MM.json, который
// НИКОГДА не удаляется и не перезаписывается. Так со временем можно будет
// посмотреть, насколько сильно поменялся топ, скажем, за год.
//
// Расписания в привычном смысле (cron) тут нет — вместо этого при каждом
// старте сервера (и по /rebuildstats) проверяем: есть ли уже архив за
// текущий месяц? Если нет — начинаем (или продолжаем, если прошлая попытка
// прервалась) его собирать. Прогресс каждые CHECKPOINT_EVERY фигурок
// сохраняется в data/analytics_checkpoint.json, так что случайное падение
// процесса не откатывает всё к нулю — при следующем запуске обход
// продолжится с того места, где остановился.

const fs = require("fs");
const path = require("path");
const herobloks = require("./herobloks");

// Обе папки — на постоянном диске Railway (data/state/, не сбрасывается
// деплоями, см. server/bootstrap.js), иначе собранные архивы пропадали бы
// при каждом обновлении кода, как раньше пропадали вишлисты.
const ARCHIVE_DIR = path.join(__dirname, "data", "state", "analytics_archive");
const CHECKPOINT_FILE = path.join(__dirname, "data", "state", "analytics_checkpoint.json");
const CONCURRENCY = 2; // на маленьком тарифе Railway обход всей базы при
// параллельности 6 упирался в лимит памяти контейнера и ронял весь процесс.
const CHECKPOINT_EVERY = 100; // сохранять прогресс на диск каждые N фигурок
const TOP_N = 20;
const MAX_YEAR = 2020; // фигурки позже — сознательно не учитываем (см. выше)

let building = false;

function ensureArchiveDir() {
  try { fs.mkdirSync(ARCHIVE_DIR, { recursive: true }); } catch (e) {}
}

function monthKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function archiveFilePath(key) {
  return path.join(ARCHIVE_DIR, `${key}.json`);
}

// Список всех месяцев, за которые уже есть готовый архив (по возрастанию —
// "2026-06", "2026-07", ...).
function listArchiveKeys() {
  ensureArchiveDir();
  try {
    return fs.readdirSync(ARCHIVE_DIR)
      .filter(f => /^\d{4}-\d{2}\.json$/.test(f))
      .map(f => f.replace(/\.json$/, ""))
      .sort();
  } catch (e) {
    return [];
  }
}

function hasArchive(key) {
  return fs.existsSync(archiveFilePath(key));
}

function readArchive(key) {
  try {
    return JSON.parse(fs.readFileSync(archiveFilePath(key), "utf8"));
  } catch (e) {
    return null;
  }
}

// Самый свежий готовый архив — то, что показывается на главном экране
// мини-приложения прямо сейчас.
function getLatestArchive() {
  const keys = listArchiveKeys();
  if (keys.length === 0) return null;
  return readArchive(keys[keys.length - 1]);
}

function getCached() {
  return getLatestArchive();
}

function isBuilding() {
  return building;
}

function loadCheckpoint(key) {
  try {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));
    if (cp && cp.month === key && Number.isFinite(cp.total)) return cp;
  } catch (e) {}
  return null;
}

function saveCheckpoint(cp) {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp), "utf8");
  } catch (e) {
    console.error("analytics: не удалось сохранить чекпоинт на диск:", e.message);
  }
}

// Держит только TOP_N лучших элементов по cmp — не нужно хранить в памяти
// весь список фигурок (~6500 штук), чтобы в конце найти топ-20.
function insertTop(list, item, cmp) {
  list.push(item);
  list.sort(cmp);
  if (list.length > TOP_N) list.length = TOP_N;
}

/**
 * Обходит всю базу фигурок и собирает архив статистики за месяц targetKey
 * (по умолчанию — текущий календарный месяц). onProgress(done, total)
 * вызывается время от времени, чтобы можно было показать прогресс (например
 * в чате бота). Если предыдущая попытка за этот же месяц была прервана
 * (падение процесса) — продолжает с сохранённого чекпоинта, а не с начала.
 */
async function buildAnalytics(onProgress, targetKey) {
  if (building) return getLatestArchive();
  building = true;
  const key = targetKey || monthKey();
  try {
    ensureArchiveDir();
    const list = herobloks.getAllFigures(); // [{href, brand, serial, name}]

    let checkpoint = loadCheckpoint(key);
    // Чекпоинты старого формата (до появления noOwnersList) хранили только
    // счётчик, а не сами фигурки — по нему список не восстановить, поэтому
    // при встрече такого чекпоинта обход начинаем заново, а не продолжаем
    // с середины (иначе список получился бы неполным).
    if (!checkpoint || checkpoint.total !== list.length || !Array.isArray(checkpoint.noOwnersList)) {
      checkpoint = { month: key, cursor: 0, total: list.length, topOwners: [], yearCounts: {}, noOwnersList: [] };
    }

    let cursor = checkpoint.cursor;
    const topOwners = checkpoint.topOwners;
    const yearCounts = checkpoint.yearCounts;
    // Все фигурки (из учитываемых по году), которыми пока никто не владеет —
    // не только счётчик, а сам список, чтобы можно было посмотреть его в
    // мини-приложении и отфильтровать по бренду.
    const noOwnersList = checkpoint.noOwnersList || [];

    if (onProgress && cursor > 0) onProgress(cursor, list.length);

    while (cursor < list.length) {
      const batchEnd = Math.min(cursor + CONCURRENCY, list.length);
      const batch = [];
      for (let i = cursor; i < batchEnd; i++) batch.push(list[i]);

      await Promise.all(batch.map(async item => {
        try {
          // fetchFigureDetailsRaw — без кэширования: при полном обходе базы
          // каждая фигурка запрашивается ровно один раз, а кэш на 6500+
          // записей только зря ест память маленького контейнера Railway.
          const details = await herobloks.fetchFigureDetailsRaw(item.href);
          const yearRaw = details.year ? parseInt(details.year, 10) : null;
          const year = Number.isFinite(yearRaw) ? yearRaw : null;
          // Без года или позже MAX_YEAR — сознательно не учитываем.
          if (year === null || year > MAX_YEAR) return;
          const owners = typeof details.owners === "number" ? details.owners : 0;
          if (owners > 0) {
            insertTop(topOwners, {
              href: item.href,
              name: details.name || item.name,
              brand: details.brand || item.brand,
              serial: details.serial || item.serial,
              year,
              owners,
              imageUrl: details.imageUrl || null
            }, (a, b) => b.owners - a.owners);
          } else {
            noOwnersList.push({
              href: item.href,
              name: details.name || item.name,
              brand: details.brand || item.brand,
              serial: details.serial || item.serial,
              year
            });
          }
          yearCounts[year] = (yearCounts[year] || 0) + 1;
        } catch (e) {
          // Пропускаем — одна неудачная фигурка не должна ронять весь обход.
        }
      }));

      cursor = batchEnd;

      if (cursor % CHECKPOINT_EVERY < CONCURRENCY || cursor === list.length) {
        saveCheckpoint({ month: key, cursor, total: list.length, topOwners, yearCounts, noOwnersList });
      }
      if (onProgress && (cursor % 250 < CONCURRENCY || cursor === list.length)) {
        onProgress(cursor, list.length);
      }
    }

    const byYear = Object.keys(yearCounts)
      .map(year => ({ year: parseInt(year, 10), count: yearCounts[year] }))
      .sort((a, b) => a.year - b.year);

    const data = {
      month: key,
      builtAt: new Date().toISOString(),
      totalFigures: list.length,
      topOwners,
      byYear,
      noOwnersCount: noOwnersList.length,
      noOwnersList
    };
    fs.writeFileSync(archiveFilePath(key), JSON.stringify(data, null, 2), "utf8");
    try { fs.unlinkSync(CHECKPOINT_FILE); } catch (e) {}
    return data;
  } finally {
    building = false;
  }
}

// Если за текущий календарный месяц архива ещё нет — начинаем (или
// продолжаем) его собирать в фоне. Специального планировщика "по первым
// числам" нет: проверка идёт при каждом старте сервера, и как только
// наступает новый месяц (а сервер так или иначе перезапускается — из-за
// деплоев или иначе), она это заметит и запустит сборку заново уже за новый
// месяц. Готовые архивы за прошлые месяцы никогда не трогаются и не
// удаляются.
function maybeAutoBuildMonthly() {
  const key = monthKey();
  if (hasArchive(key) || building) return;
  console.log(`analytics: архива за ${key} ещё нет — запускаю (или продолжаю) сбор в фоне...`);
  buildAnalytics((done, total) => console.log(`analytics: ${key}: обработано ${done}/${total}`), key)
    .then(() => console.log(`analytics: архив за ${key} готов`))
    .catch(e => console.error("analytics: ошибка при сборе статистики:", e.message));
}

module.exports = {
  getCached,
  isBuilding,
  buildAnalytics,
  maybeAutoBuildMonthly,
  listArchiveKeys,
  readArchive,
  monthKey,
  hasArchive
};
