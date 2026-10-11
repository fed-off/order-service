#!/usr/bin/env node
/*
 * parse.js — парсер source/sheet.html -> data.js + source/parse-report.txt
 * Node.js, без внешних зависимостей.
 *
 * СТОЛБЦЫ (ищутся по имени заголовка, фолбэк на известный индекс):
 *   Изделие -> product (обяз. непустая строка)
 *   перечень деталей -> fileDescription (серый; не обяз.; дефолт: не указано)
 *   Название файла -> fileName (обяз. непустая строка)
 *   номер станка -> только распознавание строки-данных (в вывод не идёт)
 *   Расстояние между головами -> distanceCm (обяз. число; пробелы = брак)
 *   количество голов -> ключ 2/4 (иное -> пропуск строки)
 *   время резки (AB) -> ГЕЙТ: пусто/0/нераспознано -> пропуск строки
 *   Итого время на файл (AD) -> timeSec (обяз.; берём если AB прошёл гейт)
 *
 * СТРОКА-ДАННЫХ = непустое Название файла И числовой номер станка
 * (отсекает легенду, заголовки, пояснение и пустые Итого).
 * Изделие протягивается по rowspan; пустое имя -> carry-forward.
 * У файла ВСЕГДА есть heads[2] и heads[4]; нет данных -> distanceCm/timeSec = 0.
 * Коллизия (разные distance/time в корзине) -> оставляем ПЕРВОЕ + пишем в отчёт.
 * Перед записью прежний data.js клонируется рядом (data.<дата>_<время>.js).
 * кол-во повторов не хранится. Подробности: source/README.md.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'source', 'sheet.html');
const OUT = path.join(__dirname, 'data.js');
const REPORT = path.join(__dirname, 'source', 'parse-report.txt');

const DEFAULT_IDX = {
  product: 0,
  parts: 14,
  fileName: 15,
  machine: 16,
  distance: 17,
  heads: 20,
  abTime: 27,
  time: 29,
};

const HEADER_NAMES = {
  product: ['Изделие'],
  parts: ['перечень деталей'],
  fileName: ['Название файла'],
  machine: ['номер станка'],
  distance: ['Расстояние между головами'],
  heads: ['количество голов'],
  abTime: ['время резки'],
  time: ['Итого время на файл'],
};

const VALID_HEADS = [2, 4];
const DEFAULT_DESC = 'не указано';

// ---------- HTML -> прямоугольная сетка ----------

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTbody(html) {
  const m = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!m) throw new Error('<tbody> не найден — проверьте формат экспорта Google Таблиц');
  return m[1];
}

function extractRows(tbodyHtml) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tbodyHtml)) !== null) rows.push(m[1]);
  return rows;
}

function extractCells(rowHtml) {
  const cells = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const rs = (attrs.match(/rowspan="(\d+)"/i) || [])[1];
    const cs = (attrs.match(/colspan="(\d+)"/i) || [])[1];
    cells.push({
      text: stripTags(inner),
      rowspan: rs ? parseInt(rs, 10) : 1,
      colspan: cs ? parseInt(cs, 10) : 1,
    });
  }
  return cells;
}

function buildGrid(tbodyHtml) {
  const rows = extractRows(tbodyHtml);
  const grid = [];
  const occupied = Object.create(null);
  for (let r = 0; r < rows.length; r++) {
    const cells = extractCells(rows[r]);
    const rowArr = [];
    let c = 0;
    for (const cell of cells) {
      while (occupied[r + ',' + c] !== undefined) {
        rowArr[c] = occupied[r + ',' + c];
        c++;
      }
      for (let k = 0; k < cell.colspan; k++) {
        rowArr[c] = cell.text;
        if (cell.rowspan > 1) {
          for (let rr = 1; rr < cell.rowspan; rr++) {
            occupied[r + rr + ',' + c] = cell.text;
          }
        }
        c++;
      }
    }
    while (occupied[r + ',' + c] !== undefined) {
      rowArr[c] = occupied[r + ',' + c];
      c++;
    }
    grid.push(rowArr);
  }
  return grid;
}

function detectColumns(grid) {
  const found = {};
  const notes = [];
  const limit = Math.min(grid.length, 12);
  for (const key of Object.keys(HEADER_NAMES)) {
    let idx = null;
    for (let r = 0; r < limit && idx === null; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = (row[c] || '').trim();
        if (!cell) continue;
        if (HEADER_NAMES[key].some((name) => cell.indexOf(name) !== -1)) {
          idx = c;
          break;
        }
      }
      if (idx !== null) break;
    }
    if (idx === null) {
      found[key] = DEFAULT_IDX[key];
      notes.push('Столбец ' + HEADER_NAMES[key][0] + ' НЕ найден по заголовку — фолбэк на индекс ' + DEFAULT_IDX[key] + '.');
    } else {
      if (idx !== DEFAULT_IDX[key]) {
        notes.push('Столбец ' + HEADER_NAMES[key][0] + ' найден на индексе ' + idx + ' (ожидался ' + DEFAULT_IDX[key] + ').');
      }
      found[key] = idx;
    }
  }
  return { found: found, notes: notes };
}

// ---------- нормализация значений ----------

function textOrNull(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  return t === '' ? null : t;
}

// Расстояние: строгое десятичное число. Пробелы внутри (напр. 45 800,00) = БРАК.
function parseDistance(raw) {
  if (raw == null) return { ok: false, value: null, reason: 'empty' };
  const s = String(raw).trim();
  if (s === '') return { ok: false, value: null, reason: 'empty' };
  if (/\s/.test(s)) return { ok: false, value: null, reason: 'spaces' };
  if (!/^\d+([.,]\d+)?$/.test(s)) return { ok: false, value: null, reason: 'chars' };
  const v = parseFloat(s.replace(',', '.'));
  if (!Number.isFinite(v)) return { ok: false, value: null, reason: 'nan' };
  return { ok: true, value: v, reason: null };
}

// Количество голов: положительное целое или null.
function parseHeads(raw) {
  const s = textOrNull(raw);
  if (s == null) return null;
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

// Номер станка: число (для распознавания строки-данных). Мусор -> null.
function parseMachine(raw) {
  const s = textOrNull(raw);
  if (s == null) return null;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

// Время: H:MM:SS | MM:SS | <сек> -> секунды; иначе null.
function parseTime(raw) {
  const s = textOrNull(raw);
  if (s == null) return null;
  const parts = s.split(':');
  const nums = parts.map((p) => Number(p.replace(',', '.')));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  if (parts.length === 1) return nums[0];
  return null;
}

// ---------- основная логика ----------

// ---------- бэкап предыдущего data.js ----------

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Метка даты/времени запуска для имени бэкапа: YYYY-MM-DD_HH-MM-SS (без ':' — для Windows).
function backupStamp(d) {
  return (
    d.getFullYear() + '-' +
    pad2(d.getMonth() + 1) + '-' +
    pad2(d.getDate()) + '_' +
    pad2(d.getHours()) + '-' +
    pad2(d.getMinutes()) + '-' +
    pad2(d.getSeconds())
  );
}

// Если OUT уже существует — клонируем его в файл с датой запуска в имени
// (напр. data.2026-10-11_13-44-05.js) ПЕРЕД тем, как парсер перезапишет data.js.
// Возвращает путь бэкапа или null (если исходного файла не было).
function backupExistingOut() {
  if (!fs.existsSync(OUT)) return null;
  const dir = path.dirname(OUT);
  const base = path.basename(OUT, path.extname(OUT));
  const ext = path.extname(OUT);
  const stamp = backupStamp(new Date());
  let backupPath = path.join(dir, base + '.' + stamp + ext);
  let i = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(dir, base + '.' + stamp + '.' + i + ext);
    i++;
  }
  fs.copyFileSync(OUT, backupPath);
  return backupPath;
}

function main() {
  const backupPath = backupExistingOut();
  if (backupPath) console.log('Бэкап предыдущего data.js -> ' + backupPath);
  const html = fs.readFileSync(SRC, 'utf8');
  const tbody = extractTbody(html);
  const grid = buildGrid(tbody);
  const detected = detectColumns(grid);
  const IDX = detected.found;
  const colNotes = detected.notes;

  const warnings = [];
  const collisions = [];
  const infos = [];
  const stats = {
    rows: grid.length,
    dataRows: 0,
    skippedNoAB: 0,
    skippedDistance: 0,
    skippedTime: 0,
    skippedHeads: 0,
    skippedNoProduct: 0,
  };

  const products = [];
  let currentProductName = null;
  let currentProduct = null;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    const fileName = textOrNull(row[IDX.fileName]);
    const machine = parseMachine(row[IDX.machine]);

    if (!fileName || machine == null) continue;
    stats.dataRows++;

    const ctx = 'gridRow ' + r + ' | ' + fileName;

    const productName = textOrNull(row[IDX.product]);
    if (productName) currentProductName = productName;

    const abSec = parseTime(row[IDX.abTime]);
    if (abSec == null || abSec === 0) {
      stats.skippedNoAB++;
      continue;
    }

    const heads = parseHeads(row[IDX.heads]);
    if (heads == null || VALID_HEADS.indexOf(heads) === -1) {
      stats.skippedHeads++;
      warnings.push('количество голов не 2/4 (' + row[IDX.heads] + ') — пропуск. ' + ctx);
      continue;
    }

    const distRes = parseDistance(row[IDX.distance]);
    if (!distRes.ok) {
      stats.skippedDistance++;
      warnings.push('расстояние-брак [' + distRes.reason + '] (' + row[IDX.distance] + ') — пропуск. ' + ctx);
      continue;
    }
    const distance = distRes.value;

    const timeSec = parseTime(row[IDX.time]);
    if (timeSec == null || timeSec === 0) {
      stats.skippedTime++;
      warnings.push('AD время пусто/0/нераспознано (' + row[IDX.time] + ') при AB>0 — пропуск. ' + ctx);
      continue;
    }

    if (distance > 1000) {
      warnings.push('подозрительно большое расстояние ' + distance + ' см — проверьте источник. ' + ctx);
    }

    if (!currentProductName) {
      stats.skippedNoProduct++;
      warnings.push('нет изделия (пусто и нет предыдущего) — пропуск. ' + ctx);
      continue;
    }

    if (!currentProduct || currentProduct.product !== currentProductName) {
      currentProduct = {
        id: 'p' + String(products.length + 1).padStart(3, '0'),
        product: currentProductName,
        files: [],
      };
      products.push(currentProduct);
    }

    let file = currentProduct.files.find((f) => f.fileName === fileName);
    if (!file) {
      file = { fileName: fileName, fileDescription: null, headsMap: {} };
      currentProduct.files.push(file);
    }

    const descRaw = textOrNull(row[IDX.parts]);
    if (descRaw) {
      if (file.fileDescription == null) {
        file.fileDescription = descRaw;
      } else if (file.fileDescription !== descRaw) {
        infos.push('разное описание у ' + fileName + ': оставлено ' + file.fileDescription + ', проигнорировано ' + descRaw + '. ' + ctx);
      }
    }

    const key = String(heads);
    if (file.headsMap[key] == null) {
      file.headsMap[key] = { distanceCm: distance, timeSec: timeSec };
    } else {
      const ex = file.headsMap[key];
      if (ex.distanceCm !== distance || ex.timeSec !== timeSec) {
        collisions.push('коллизия ' + fileName + ' heads=' + key + ': оставлено d=' + ex.distanceCm + ' t=' + ex.timeSec + ', проигнорировано d=' + distance + ' t=' + timeSec + '. ' + ctx);
      }
    }
  }

  for (const p of products) {
    for (const f of p.files) {
      const heads = {};
      for (const h of VALID_HEADS) {
        const key = String(h);
        heads[key] = f.headsMap[key] || { distanceCm: 0, timeSec: 0 };
      }
      f.heads = heads;
      if (f.fileDescription == null) f.fileDescription = DEFAULT_DESC;
      delete f.headsMap;
    }
  }

  const totalFiles = products.reduce((s, p) => s + p.files.length, 0);

  const banner =
    '// data.js — АВТОГЕНЕРАЦИЯ из source/sheet.html (скрипт parse.js). Не редактировать вручную.\n' +
    '// изделие -> файлы (детали) -> heads { 2: {distanceCm, timeSec}, 4: {distanceCm, timeSec} }.\n' +
    '// Время в секундах. Нет данных по корзине голов -> distanceCm/timeSec = 0.\n' +
    '// кол-во повторов не хранится. Подробности и правила: source/README.md.\n\n';

  const body =
    'const DATA = ' + JSON.stringify(products, null, 2) + ';\n\n' +
    "if (typeof module !== 'undefined' && module.exports) { module.exports = DATA; }\n";

  fs.writeFileSync(OUT, banner + body, 'utf8');

  const L = [];
  L.push('=== ОТЧЁТ ПАРСЕРА source/sheet.html ===');
  L.push('Сгенерировано: ' + new Date().toISOString());
  L.push('Бэкап предыдущего data.js: ' + (backupPath ? path.basename(backupPath) : 'нет (файл не существовал)'));
  L.push('');
  L.push('-- Определение столбцов --');
  if (colNotes.length === 0) L.push('  все столбцы найдены по заголовкам на ожидаемых индексах.');
  colNotes.forEach((n) => L.push('  ' + n));
  L.push('  итоговые индексы: ' + JSON.stringify(IDX));
  L.push('');
  L.push('-- Счётчики --');
  L.push('  строк в сетке: ' + stats.rows);
  L.push('  строк-данных (файл+стенок): ' + stats.dataRows);
  L.push('  изделий: ' + products.length);
  L.push('  файлов: ' + totalFiles);
  L.push('');
  L.push('-- Пропуски строк-данных --');
  L.push('  AB-гейт (нет времени резки): ' + stats.skippedNoAB);
  L.push('  голова не 2/4: ' + stats.skippedHeads);
  L.push('  расстояние-брак: ' + stats.skippedDistance);
  L.push('  AD-время брак: ' + stats.skippedTime);
  L.push('  нет изделия: ' + stats.skippedNoProduct);
  L.push('');
  L.push('-- Коллизии file+heads (оставлено первое): ' + collisions.length + ' --');
  collisions.forEach((c) => L.push('  ' + c));
  L.push('');
  L.push('-- Предупреждения: ' + warnings.length + ' --');
  warnings.forEach((w) => L.push('  ' + w));
  L.push('');
  L.push('-- Инфо: ' + infos.length + ' --');
  infos.forEach((i) => L.push('  ' + i));
  L.push('');
  fs.writeFileSync(REPORT, L.join('\n'), 'utf8');

  console.log('ГОТОВО -> ' + OUT);
  if (backupPath) console.log('Бэкап -> ' + backupPath);
  console.log('Отчёт  -> ' + REPORT);
  console.log('Изделий: ' + products.length + ' | файлов: ' + totalFiles);
  console.log('Пропуски: AB ' + stats.skippedNoAB + ' | голова ' + stats.skippedHeads + ' | расст ' + stats.skippedDistance + ' | время ' + stats.skippedTime + ' | изд ' + stats.skippedNoProduct);
  console.log('Коллизий: ' + collisions.length + ' | предупреждений: ' + warnings.length + ' | инфо: ' + infos.length);

  const sne = products.find((p) => p.product && p.product.indexOf('Снегурка 2') !== -1);
  console.log('');
  console.log('--- ПРОВЕРКА: Коробка НГ (Снегурка 2) ---');
  console.log(JSON.stringify(sne, null, 2));
}

main();
