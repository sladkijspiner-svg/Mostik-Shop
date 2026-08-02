// ---- Поиск фигурок по коду или по названию на herobloks.com ----
//
// У herobloks.com нет простого публичного API для поиска, поэтому вместо
// "живого" поиска на их сайте бот использует свою локальную базу (файл
// data/herobloks_index.json) — она заранее собрана из каталога herobloks.com
// (только фигурки по теме Marvel, только настоящие бренды-производители,
// без официального Lego и без "самодельных" кастом-мастерских).
//
// Логика такая:
//   1. Покупатель пишет боту код ("PG206", "pg-206", "pogo 206", "пг206")
//      или название персонажа ("Wolverine", "Росомаха") — можно сразу в чат,
//      а можно через кнопку «Найти фигурку».
//   2. Бот приводит текст к единому виду и ищет совпадение в локальной базе.
//   3. Если нашлось — бот идёт на страницу этой фигурки на herobloks.com
//      "вживую", забирает оттуда все фото и описание и присылает покупателю.
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
  console.warn("herobloks: не удалось загрузить data/herobloks_index.json — поиск фигурок работать не будет.", e.message);
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
 * Пытается найти фигурку(и) по коду в произвольном тексте сообщения.
 * Возвращает массив совпадений вида {h(ref), b(rand), s(erial)} без дублей,
 * максимум 5 штук. Пустой массив, если похоже, что кода тут нет.
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

// ---- Поиск по названию персонажа ----

// На herobloks.com названия фигур — только на английском. Небольшой словарь
// частых русских названий персонажей Marvel, чтобы "Росомаха" тоже находило
// "Wolverine". Список не претендует на полноту — по остальным именам поиск
// сработает, если написать по-английски или транслитом.
const RU_NAME_HINTS = {
  "росомаха": "wolverine",
  "человек паук": "spider-man",
  "человек-паук": "spider-man",
  "паук": "spider-man",
  "железный человек": "iron man",
  "тор": "thor",
  "халк": "hulk",
  "капитан америка": "captain america",
  "черная пантера": "black panther",
  "чёрная пантера": "black panther",
  "локи": "loki",
  "танос": "thanos",
  "дэдпул": "deadpool",
  "дедпул": "deadpool",
  "веном": "venom",
  "доктор стрэндж": "doctor strange",
  "стрэндж": "strange",
  "алая ведьма": "scarlet witch",
  "ванда": "scarlet witch",
  "соколиный глаз": "hawkeye",
  "черная вдова": "black widow",
  "чёрная вдова": "black widow",
  "грут": "groot",
  "ракета": "rocket",
  "звёздный лорд": "star-lord",
  "звездный лорд": "star-lord",
  "гамора": "gamora",
  "ник фьюри": "nick fury",
  "мстители": "avengers",
  "циклоп": "cyclops",
  "шторм": "storm",
  "магнето": "magneto",
  "джаггернаут": "juggernaut",
  "профессор икс": "professor x",
  "мистик": "mystique",
  "халкбастер": "hulkbuster",
  "нэд": "ned",
  "существо": "thing",
  "серебряный серфер": "silver surfer",
  "фантастическая четверка": "fantastic four",
  "фантастическая четвёрка": "fantastic four",
  "мистер фантастик": "mr fantastic",
  "человек факел": "human torch",
  "женщина невидимка": "invisible woman",
  "квиксильвер": "quicksilver",
  "ртуть": "quicksilver",
  "человек муравей": "ant-man",
  "человек-муравей": "ant-man",
  "оса": "wasp",
  "капитан марвел": "captain marvel",
  "мисс марвел": "ms marvel",
  "сорвиголова": "daredevil",
  "электра": "elektra",
  "джокер": "joker",
  "халк оборотень": "she-hulk",
  "женщина халк": "she-hulk"
};

function translateQueryHints(lower) {
  let out = lower;
  for (const ru of Object.keys(RU_NAME_HINTS)) {
    if (out.includes(ru)) {
      out = out.split(ru).join(RU_NAME_HINTS[ru]);
    }
  }
  return out;
}

// slug из ссылки -> примерное отображаемое имя ("green-scar" -> "Green Scar").
// Не идеально (не отличит дефис в имени от пробела), но для списка на выбор достаточно —
// точное имя бот всё равно подтянет с самой страницы herobloks.com при показе карточки.
function nameFromHref(href) {
  const parts = href.split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "";
  const words = slug.split("-").filter(Boolean);
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

let NAME_LIST = null; // [{href, brand, serial, name, nameLower}]
function buildNameList() {
  if (NAME_LIST) return NAME_LIST;
  const seen = new Set();
  const list = [];
  for (const key of Object.keys(INDEX.serials || {})) {
    for (const e of INDEX.serials[key]) {
      if (seen.has(e.h)) continue;
      seen.add(e.h);
      const name = nameFromHref(e.h);
      const brandLabel = (e.b || "").replace(/-/g, " ");
      const label = `${name} (${brandLabel} ${e.s || ""})`.replace(/\s+/g, " ").trim();
      list.push({ href: e.h, brand: e.b, serial: e.s, name, nameLower: name.toLowerCase(), label });
    }
  }
  NAME_LIST = list;
  return list;
}

/**
 * Ищет фигурки по названию персонажа (по-английски, транслитом или по паре
 * популярных русских названий). Возвращает до 10 совпадений
 * {href, brand, serial, name}.
 */
function findFigureByName(rawQuery) {
  if (!rawQuery) return [];
  const list = buildNameList();
  const lower = translateQueryHints(rawQuery.toLowerCase().trim());
  if (lower.length < 2) return [];
  const matches = list.filter(item => item.nameLower.includes(lower));
  return matches.slice(0, 10);
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
 * Забирает "вживую" со страницы herobloks.com название, все фото и
 * характеристики конкретной фигурки по относительной ссылке (например
 * "/figures/7400/pogo/pg-206/deadpool-(ultimate)").
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

  // Все фото фигурки (не только главное) — на странице бывает несколько
  // ракурсов/вариантов упаковки.
  const imgRe = /https:\/\/static\.herobloks\.com\/x\/figure_images\/[^"'\s]+\.jpg/g;
  const imageUrls = Array.from(new Set(html.match(imgRe) || []));
  if (imageUrls.length === 0) {
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (ogMatch) imageUrls.push(ogMatch[1]);
  }

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
    imageUrls,
    imageUrl: imageUrls[0] || null,
    pageUrl: url
  };
}

module.exports = { findFigureMatches, findFigureByName, fetchFigureDetails, compactCode };
