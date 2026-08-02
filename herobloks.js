// ---- Поиск фигурок по коду (PG-206 и т.п.) на herobloks.com ----
//
// У herobloks.com нет простого публичного API для поиска, поэтому вместо
// "живого" поиска на их сайте бот использует свою локальную базу (файл
// data/herobloks_index.json) — она заранее собрана из каталога herobloks.com
// (только фигурки по теме Marvel, только настоящие бренды-производители,
// без официального Lego и без "самодельных" кастом-мастерских).
//
// Логика такая:
//   1. Покупатель пишет боту код, например "PG206", "pg-206", "pogo 206", "пг206".
//   2. Бот приводит текст к единому виду и ищет совпадение в локальной базе.
//   3. Если нашлось — бот идёт на страницу этой фигурки на herobloks.com
//      "вживую", забирает оттуда картинку и описание и присылает покупателю.
//
// Если базу нужно расширить (другие бренды/темы) — файл data/herobloks_index.json
// можно пересобрать так же, как он был собран изначально, и просто заменить.

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "data", "herobloks_index.json");

let INDEX = { serials: {}, brandPrefix: {} };
try {
  INDEX = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  const count = Object.keys(INDEX.serials || {}).length;
  console.log(`herobloks: локальная база загружена, фигурок в индексе: ${count}`);
} catch (e) {
  console.warn("herobloks: не удалось загрузить data/herobloks_index.json — поиск по коду фигурок работать не будет.", e.message);
}

// Простая фонетическая транслитерация кириллицы в латиницу —
// чтобы "пг206" превращалось в "PG206" и совпадало с базой.
const CYR_TO_LAT = {
  "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "E", "Ж": "ZH", "З": "Z",
  "И": "I", "Й": "Y", "К": "K", "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R",
  "С": "S", "Т": "T", "У": "U", "Ф": "F", "Х": "H", "Ц": "TS", "Ч": "CH", "Ш": "SH", "Щ": "SCH",
  "Ъ": "", "Ы": "Y", "Ь": "", "Э": "E", "Ю": "YU", "Я": "YA"
};

function transliterate(text) {
  return text
    .toUpperCase()
    .split("")
    .map(ch => (CYR_TO_LAT[ch] !== undefined ? CYR_TO_LAT[ch] : ch))
    .join("");
}

// "PG-206" / "pg 206" / "пг206" -> "PG206"
function compactCode(text) {
  return transliterate(text).replace(/[^A-Z0-9]/g, "");
}

// Названия брендов (по слагу из ссылки) в верхнем регистре без пробелов —
// чтобы "world minifigures 208" тоже находилось.
function brandNameVariants(slug) {
  const spaced = slug.replace(/-/g, " ").toUpperCase();
  const joined = spaced.replace(/\s+/g, "");
  return [spaced, joined];
}

/**
 * Пытается найти фигурку(и) по произвольному тексту сообщения пользователя.
 * Возвращает массив совпадений вида {href, brand, serial} (без дублей по href),
 * максимум 5 штук.
 */
function findFigureMatches(rawMessage) {
  if (!rawMessage || !INDEX.serials) return [];

  const results = new Map(); // href -> entry

  function tryCode(code) {
    if (!code || code.length < 3 || code.length > 14) return;
    const entries = INDEX.serials[code];
    if (entries) {
      for (const e of entries) results.set(e.h, e);
    }
  }

  // 1) Всё сообщение целиком, как один код: "PG-206" / "пг206"
  tryCode(compactCode(rawMessage));

  // 2) Отдельные слова сообщения: "хочу PG206 плиз"
  const words = rawMessage.split(/\s+/).filter(Boolean);
  for (const w of words) {
    tryCode(compactCode(w));
  }

  // 3) Пары соседних слов — "pogo 206" / "ПОГО 206" (название бренда + номер)
  if (results.size === 0 && Object.keys(INDEX.brandPrefix || {}).length) {
    const brandLookup = {}; // "POGO" -> "PG"
    for (const slug of Object.keys(INDEX.brandPrefix)) {
      const prefix = INDEX.brandPrefix[slug];
      for (const variant of brandNameVariants(slug)) {
        brandLookup[variant] = prefix;
      }
    }
    for (let i = 0; i < words.length - 1; i++) {
      const w1 = transliterate(words[i]).replace(/[^A-Z0-9 ]/g, "").trim();
      const prefix = brandLookup[w1];
      if (!prefix) continue;
      const w2 = compactCode(words[i + 1]);
      if (/^\d+$/.test(w2)) {
        tryCode(prefix + w2);
      }
    }
  }

  return Array.from(results.values()).slice(0, 5);
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Забирает "вживую" со страницы herobloks.com название, фото и характеристики
 * конкретной фигурки по относительной ссылке (например
 * "/figures/7400/pogo/-pg-206/deadpool-(ultimate)").
 */
async function fetchFigureDetails(href) {
  const url = "https://www.herobloks.com" + href;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MinifigStoreBot/1.0)" }
  });
  if (!res.ok) throw new Error("herobloks вернул статус " + res.status);
  const html = await res.text();

  const nameMatch = html.match(/id="name"[^>]*>([^<]+)</);
  const name = nameMatch ? decodeHtmlEntities(nameMatch[1].trim()) : null;

  const imageMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  const imageUrl = imageMatch ? imageMatch[1] : null;

  const fields = {};
  const fieldRe = /hbtext"[^>]*>\s*([^<:]+):?\s*<\/div>[\s\S]{0,80}?hbvalue"[^>]*>\s*([\s\S]*?)\s*<\/div>/g;
  let m;
  while ((m = fieldRe.exec(html))) {
    const label = decodeHtmlEntities(m[1].trim());
    const value = decodeHtmlEntities(m[2].replace(/\s+/g, " ").trim());
    fields[label] = value;
  }

  return {
    name,
    basename: fields["Basename"] || null,
    brand: fields["Brand"] || null,
    serial: fields["Serial"] || null,
    year: fields["Year"] || null,
    theme: fields["Theme"] || null,
    imageUrl,
    pageUrl: url
  };
}

module.exports = { findFigureMatches, fetchFigureDetails, compactCode };
