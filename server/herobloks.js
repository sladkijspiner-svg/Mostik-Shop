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
  "вулверин": "wolverine",
  "волверин": "wolverine",
  "человек паук": "spider man",
  "человек-паук": "spider man",
  "паук": "spider man",
  "спайдермен": "spider man",
  "спайдер-мен": "spider man",
  "спайдер мен": "spider man",
  "железный человек": "iron man",
  "айронмен": "iron man",
  "айрон мен": "iron man",
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
  "хоукай": "hawkeye",
  "зимний солдат": "winter soldier",
  "уинтер солдат": "winter soldier",
  "черная вдова": "black widow",
  "чёрная вдова": "black widow",
  "грут": "groot",
  "ракета": "rocket",
  "звёздный лорд": "star lord",
  "звездный лорд": "star lord",
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
  "человек муравей": "ant man",
  "человек-муравей": "ant man",
  "оса": "wasp",
  "капитан марвел": "captain marvel",
  "мисс марвел": "ms marvel",
  "сорвиголова": "daredevil",
  "электра": "elektra",
  "джокер": "joker",
  "халк оборотень": "she hulk",
  "женщина халк": "she hulk"
};

// Ключи сортируем от самых длинных к самым коротким — иначе, например,
// короткое "халк" заменится раньше составного "халк оборотень" и испортит
// более специфичное совпадение.
const RU_NAME_HINT_KEYS = Object.keys(RU_NAME_HINTS).sort((a, b) => b.length - a.length);

function translateQueryHints(lower) {
  let out = lower;
  for (const ru of RU_NAME_HINT_KEYS) {
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

// Отделяет "хвостовые" пометки в скобках вроде "(BigFig)", "(MCU)" от
// основного имени: "Symbiote Wolverine (BigFig)" -> { base: "Symbiote Wolverine", tags: ["BigFig"] }.
function splitNameTags(name) {
  const tags = [];
  const base = name
    .replace(/\(([^()]*)\)/g, (_, inner) => {
      tags.push(inner.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { base, tags };
}

// Синонимы "переодетых" версий персонажа — чтобы бот сам понимал, что
// "Symbiote Wolverine", "Wolverine Venom" и "Venomized Wolverine" — это
// один и тот же образ, и объединял их в одну категорию при поиске.
const QUALIFIER_SYNONYMS = {
  venom: "Venom",
  symbiote: "Venom",
  symbiotic: "Venom",
  venomized: "Venom",
  venomised: "Venom",
  zombie: "Zombie",
  zombified: "Zombie",
  gold: "Gold",
  golden: "Gold",
  chrome: "Chrome",
  chromed: "Chrome",
  stealth: "Stealth",
  evil: "Dark",
  dark: "Dark"
};

// Приводит название образа к "каноническому" виду, объединяя синонимичные
// варианты (см. QUALIFIER_SYNONYMS) в одну категорию, независимо от порядка
// слов и формулировки. Метки в скобках вроде "(BigFig)" сохраняются отдельно —
// это формат/размер, а не другой образ.
function canonicalizeName(name) {
  const { base, tags } = splitNameTags(name);
  const words = base.split(" ").filter(Boolean);
  let synonymTag = null;
  const rest = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (!synonymTag && QUALIFIER_SYNONYMS[key]) {
      synonymTag = QUALIFIER_SYNONYMS[key];
    } else {
      rest.push(w);
    }
  }
  const canonicalBase = synonymTag ? `${synonymTag} ${rest.join(" ")}`.trim() : base;
  const suffix = tags.length ? " (" + tags.join(") (") + ")" : "";
  return (canonicalBase + suffix).trim();
}

let NAME_LIST = null; // [{href, brand, serial, name, nameLower, baseLower, label}]
function buildNameList() {
  if (NAME_LIST) return NAME_LIST;
  const seen = new Set();
  const list = [];
  for (const key of Object.keys(INDEX.serials || {})) {
    for (const e of INDEX.serials[key]) {
      if (seen.has(e.h)) continue;
      seen.add(e.h);
      const name = nameFromHref(e.h);
      const base = splitNameTags(name).base;
      const brandLabel = (e.b || "").replace(/-/g, " ");
      const label = `${name} (${brandLabel} ${e.s || ""})`.replace(/\s+/g, " ").trim();
      list.push({
        href: e.h,
        brand: e.b,
        serial: e.s,
        name,
        nameLower: name.toLowerCase(),
        baseLower: base.toLowerCase(),
        label
      });
    }
  }
  NAME_LIST = list;
  return list;
}

/**
 * Ищет фигурки по названию персонажа (по-английски, транслитом или по паре
 * популярных русских названий). Сначала ищет только по основному имени
 * (без пометок в скобках) — чтобы "Wolverine" не находил, например,
 * "Tva Agent (Deadpool & Wolverine)", у которого Wolverine — это только
 * пометка серии, а не сам персонаж. Если по основному имени ничего не
 * нашлось — ищет уже везде. Возвращает совпадения {href, brand, serial,
 * name, label} без ограничения по числу — группировкой и ограничением
 * занимается groupFiguresByName.
 */
function findFigureByName(rawQuery, limit) {
  if (!rawQuery) return [];
  const list = buildNameList();
  const lower = translateQueryHints(rawQuery.toLowerCase().trim());
  if (lower.length < 2) return [];

  let matches = list.filter(item => item.baseLower.includes(lower));
  if (matches.length === 0) {
    matches = list.filter(item => item.nameLower.includes(lower));
  }
  return matches.slice(0, limit || 300);
}

// Расстояние Левенштейна — сколько правок (замена/вставка/удаление буквы)
// отделяет одну строку от другой. Используется для подсказок "Возможно, вы
// имели в виду?", когда точных совпадений не нашлось.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Пул кандидатов для подсказок: уникальные "канонические" названия образов
// персонажей (на английском, как на herobloks.com) плюс все русские слова
// из словаря RU_NAME_HINTS — чтобы можно было подсказать исправление и для
// опечатки в английском написании, и для опечатки в русском.
let SUGGEST_POOL = null; // [{ label, query, lower }]
function buildSuggestPool() {
  if (SUGGEST_POOL) return SUGGEST_POOL;
  const seen = new Set();
  const pool = [];
  for (const item of buildNameList()) {
    const canonical = canonicalizeName(item.name);
    const lower = canonical.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    pool.push({ label: canonical, query: canonical, lower });
  }
  for (const ru of Object.keys(RU_NAME_HINTS)) {
    const lower = ru.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const label = ru.charAt(0).toUpperCase() + ru.slice(1);
    pool.push({ label, query: ru, lower });
  }
  SUGGEST_POOL = pool;
  return pool;
}

/**
 * Подсказки "Возможно, вы имели в виду?" для случая, когда по запросу
 * ничего не нашлось — вдруг это просто опечатка. Ищет ближайшие по
 * написанию названия (расстояние Левенштейна) среди известных персонажей,
 * не дальше разумного порога, и возвращает не больше `limit` штук,
 * отсортированных от самого похожего.
 */
function suggestNames(rawQuery, limit) {
  if (!rawQuery) return [];
  const lower = rawQuery.toLowerCase().trim();
  if (lower.length < 3) return [];

  const pool = buildSuggestPool();
  const scored = [];
  for (const cand of pool) {
    // Не сравниваем строки, длины которых слишком различаются — это почти
    // наверняка не опечатка, а что-то совсем другое, и Левенштейн там будет
    // большим просто из-за разницы в длине.
    if (Math.abs(cand.lower.length - lower.length) > 4) continue;
    const dist = levenshtein(lower, cand.lower);
    const threshold = Math.max(2, Math.ceil(cand.lower.length * 0.34));
    if (dist > 0 && dist <= threshold) {
      scored.push({ label: cand.label, query: cand.query, dist });
    }
  }
  scored.sort((a, b) => a.dist - b.dist);

  const out = [];
  const seenLabels = new Set();
  for (const s of scored) {
    if (seenLabels.has(s.label)) continue;
    seenLabels.add(s.label);
    out.push({ label: s.label, query: s.query });
    if (out.length >= (limit || 4)) break;
  }
  return out;
}

/**
 * Группирует результаты поиска по образу/варианту персонажа — например у
 * "Wolverine" бывают отдельные образы "Ninja Strike Wolverine", "Venom
 * Wolverine" (объединяет "Symbiote Wolverine" / "Wolverine Venom" и т.п.),
 * а внутри каждого образа — несколько версий от разных производителей
 * (артикулы). Возвращает массив {name, items: [...]}, отсортированный по
 * названию, максимум maxGroups штук.
 */
function groupFiguresByName(matches, maxGroups) {
  const groups = new Map(); // canonicalName -> items[]
  for (const item of matches) {
    const canonical = canonicalizeName(item.name);
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push(item);
  }
  const result = Array.from(groups.entries())
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return result.slice(0, maxGroups || 300);
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
// Кэш уже забранных карточек (href -> { at, data }) — раньше КАЖДЫЙ показ
// миниатюры или карточки заново шёл на herobloks.com и парсил всю страницу
// целиком, из-за этого и поиск, и картинки грузились медленно, особенно
// повторно для одних и тех же популярных персонажей. Теперь второй и
// последующие запросы того же href отдаются из памяти мгновенно. Данные на
// herobloks.com почти никогда не меняются, поэтому срок жизни записи в
// кэше долгий.
const DETAILS_CACHE = new Map();
const DETAILS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

async function fetchFigureDetails(href) {
  const cached = DETAILS_CACHE.get(href);
  if (cached && Date.now() - cached.at < DETAILS_CACHE_TTL_MS) {
    return cached.data;
  }

  const url = "https://www.herobloks.com" + href;
  // Без явного таймаута обычный fetch может зависнуть на конкретной странице
  // навсегда, если herobloks.com не отвечает — а при обходе всей базы это
  // останавливает весь процесс (чекпоинт не двигается) вместо того, чтобы
  // просто пропустить одну проблемную фигурку и пойти дальше.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MinifigStoreBot/1.0)" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
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

  // Внизу страницы (под всеми похожими фигурками) herobloks.com показывает,
  // сколько пользователей отметили эту фигурку у себя в коллекции — например
  // "13 users own this figure". Если у фигурки пока нет владельцев, этого
  // блока на странице вообще нет — тогда считаем, что владельцев 0. Это
  // используется для аналитики "какие фигурки популярны / редки".
  const ownersMatch = html.match(/(\d+)\s+users?\s+owns?\s+this\s+figure/i);
  const owners = ownersMatch ? parseInt(ownersMatch[1], 10) : 0;

  const data = {
    name,
    basename: fields["Basename"] || null,
    brand: fields["Brand"] || null,
    serial: fields["Serial"] || null,
    year: fields["Year"] || null,
    theme: fields["Theme"] || null,
    owners,
    imageUrls,
    imageUrl: imageUrls[0] || null,
    pageUrl: url
  };
  DETAILS_CACHE.set(href, { at: Date.now(), data });
  return data;
}

// Слаг бренда из ссылки на фигурку: "/figures/7400/pogo/pg-206/deadpool-..."
// -> "pogo". Он же использовался при сборке базы data/herobloks_index.json,
// поэтому совпадает с ключами INDEX.brandPrefix.
function brandSlugFromHref(href) {
  const parts = (href || "").split("/").filter(Boolean);
  return (parts[2] || "").toLowerCase();
}

/**
 * Код для поиска этой фигурки на маркетплейсах (Ozon/Wildberries/AliExpress):
 * артикул без дефисов/пробелов, в нижнем регистре. У большинства брендов
 * (Pogo, Kopf...) в самом артикуле уже есть буквенный префикс — "PG-206" ->
 * "pg206". А вот у некоторых (например Xinh) на herobloks.com в поле Serial
 * указаны только цифры ("450") — в продаже же эти фигурки идут под кодом с
 * префиксом бренда ("XH450"), поэтому если в артикуле нет ни одной буквы,
 * приставляем префикс бренда из той же карты, что используется для разбора
 * кодов покупателей (INDEX.brandPrefix).
 */
function marketplaceQuery(href, serial) {
  const compact = compactCode(serial || "");
  if (!compact) return "";
  if (/[A-Z]/.test(compact)) return compact.toLowerCase();
  const prefix = (INDEX.brandPrefix && INDEX.brandPrefix[brandSlugFromHref(href)]) || "";
  return (prefix + compact).toLowerCase();
}

// Полный список всех фигурок в базе (для аналитики "у кого сколько" — нужно
// пройтись по всей базе целиком, а не только по результатам одного поиска).
function getAllFigures() {
  return buildNameList();
}

module.exports = {
  findFigureMatches,
  findFigureByName,
  groupFiguresByName,
  fetchFigureDetails,
  compactCode,
  marketplaceQuery,
  suggestNames,
  getAllFigures
};
