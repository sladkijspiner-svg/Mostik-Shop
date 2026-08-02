// ---- Почему это вообще нужно ----
//
// Railway при каждом деплое собирает контейнер заново из того, что лежит в
// GitHub — то есть все файлы в data/ (товары, вишлисты, архивы статистики)
// каждый раз "откатываются" к тому, что закоммичено в репозиторий. Раньше
// именно поэтому вишлист, добавленный покупателем, пропадал после
// следующего же обновления кода: server/data/wishlists.json лежал в git с
// содержимым "{}", и каждый пуш просто перезаписывал им реальные данные.
//
// Решение — постоянный диск (Volume) в Railway, подключённый к папке
// data/state/: в отличие от остального контейнера, содержимое такого диска
// НЕ пересоздаётся при деплое, а сохраняется между ними. Но у дисков есть
// особенность: они подключаются уже ПОСЛЕ сборки образа и остаются пустыми
// при самом первом запуске — файлы, которые были в этой папке во время
// сборки (например, стартовый список товаров), на диск не копируются
// автоматически. Поэтому этот модуль при каждом старте сервера проверяет:
// если в data/state/ чего-то ещё нет — переносит туда стартовую копию из
// обычного (git-овского) data/, и дальше уже все изменения (новые товары,
// вишлисты покупателей, архивы статистики) пишутся туда и остаются там
// навсегда, независимо от того, сколько раз потом обновится код.
//
// herobloks_index.json сюда не входит — это статичный справочник (собран
// один раз с herobloks.com и в рантайме никогда не меняется), поэтому ему
// вполне можно оставаться обычным файлом в самом образе.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const STATE_DIR = path.join(DATA_DIR, "state");

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
}

// Если файла ещё нет в data/state/ — берём стартовую копию из обычного
// data/ (как он был закоммичен в git), а если и её нет — создаём с
// содержимым по умолчанию.
function seedFile(seedPath, statePath, defaultContent) {
  if (fs.existsSync(statePath)) return;
  ensureDir(path.dirname(statePath));
  try {
    if (fs.existsSync(seedPath)) {
      fs.copyFileSync(seedPath, statePath);
    } else {
      fs.writeFileSync(statePath, defaultContent, "utf8");
    }
  } catch (e) {
    console.error(`bootstrap: не удалось подготовить ${statePath}:`, e.message);
  }
}

function run() {
  ensureDir(STATE_DIR);
  seedFile(path.join(DATA_DIR, "products.json"), path.join(STATE_DIR, "products.json"), "[]");
  seedFile(path.join(DATA_DIR, "wishlists.json"), path.join(STATE_DIR, "wishlists.json"), "{}");
  ensureDir(path.join(STATE_DIR, "analytics_archive"));
}

module.exports = { run, STATE_DIR };
