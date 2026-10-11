#!/usr/bin/env node
/*
 * parse.js — парсер source/sheet.html -> data.js + report.js + source/parse-report.txt
 * Node.js, без внешних зависимостей.
 * report.js — для страницы report.html: строки с файлом, не попавшие в базу
 * (с проблемными столбцами), «попало, но проверьте», статистика и изменения базы.
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
 * (отсекает легенду, заголовки, пояснение и пустые Итого). Файл без числового
 * номера станка ПОСЛЕ первой строки-данных — пропуск с записью в отчёт.
 * Проблемы строки собираются все сразу (для отчёта), счётчик — по первой.
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
const REPORT_JS = path.join(__dirname, 'report.js');

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

// Строка <tbody> -> { html, sheetRow }. sheetRow — номер строки, как его видит
// мастер в Google Таблице (заголовок строки <th>); нет заголовка -> порядковый номер.
function extractRows(tbodyHtml) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tbodyHtml)) !== null) {
    const num = m[1].match(/class="row-header-wrapper"[^>]*>\s*(\d+)\s*</i);
    rows.push({ html: m[1], sheetRow: num ? parseInt(num[1], 10) : rows.length + 1 });
  }
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
  const sheetRows = rows.map((row) => row.sheetRow);
  const occupied = Object.create(null);
  for (let r = 0; r < rows.length; r++) {
    const cells = extractCells(rows[r].html);
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
  return { grid: grid, sheetRows: sheetRows };
}

// Индекс столбца (с 0) -> буква, как в Google Таблице: 0 -> A, 27 -> AB.
function colLetter(idx) {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function detectColumns(grid) {
  const found = {};
  const headers = {};
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
          headers[key] = cell;
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
  return { found: found, headers: headers, notes: notes };
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

// Секунды -> ч:мм:сс (для текстов отчёта).
function formatHms(sec) {
  return Math.floor(sec / 3600) + ':' + pad2(Math.floor(sec % 3600 / 60)) + ':' + pad2(Math.round(sec % 60));
}

// ---------- отчёт для мастера (report.js) ----------

// Прежняя база (до перезаписи) — для блока «изменения с прошлого обновления».
function loadPreviousData() {
  if (!fs.existsSync(OUT)) return null;
  try {
    const sandbox = {};
    new Function('module', fs.readFileSync(OUT, 'utf8') + '\nmodule.exports = DATA;')(sandbox);
    return Array.isArray(sandbox.exports) ? sandbox.exports : null;
  } catch (e) {
    return null;
  }
}

function fileKey(product, fileName) {
  return product + '\u0000' + fileName;
}

function diffData(prev, next) {
  if (!prev) return null;
  const index = (data) => {
    const m = new Map();
    for (const p of data) for (const f of p.files) m.set(fileKey(p.product, f.fileName), { product: p.product, fileName: f.fileName, heads: f.heads });
    return m;
  };
  const a = index(prev);
  const b = index(next);
  const prevProducts = new Set(prev.map((p) => p.product));
  const nextProducts = new Set(next.map((p) => p.product));
  const pick = (f) => ({ product: f.product, fileName: f.fileName });
  const changedFiles = [];
  for (const [k, f] of b) {
    const old = a.get(k);
    if (old && JSON.stringify(old.heads) !== JSON.stringify(f.heads)) changedFiles.push(pick(f));
  }
  return {
    addedProducts: [...nextProducts].filter((p) => !prevProducts.has(p)),
    removedProducts: [...prevProducts].filter((p) => !nextProducts.has(p)),
    addedFiles: [...b.keys()].filter((k) => !a.has(k)).map((k) => pick(b.get(k))),
    removedFiles: [...a.keys()].filter((k) => !b.has(k)).map((k) => pick(a.get(k))),
    changedFiles: changedFiles,
  };
}

// Одинаковые строки (тот же файл и те же значения, разные станки) схлопываем в одну запись.
function groupRows(list) {
  const groups = new Map();
  for (const item of list) {
    const { sheetRow, values, ...rest } = item;
    const { machine, ...sameValues } = values;
    const key = JSON.stringify([rest, sameValues]);
    let g = groups.get(key);
    if (!g) {
      g = Object.assign({ sheetRows: [], values: Object.assign({}, sameValues, { machine: [] }) }, rest);
      groups.set(key, g);
    }
    g.sheetRows.push(sheetRow);
    if (machine && g.values.machine.indexOf(machine) === -1) g.values.machine.push(machine);
  }
  return [...groups.values()].map((g) => Object.assign(g, { values: Object.assign(g.values, { machine: g.values.machine.join(', ') }) }));
}

// ---------- основная логика ----------

function main() {
  const prevData = loadPreviousData();
  const backupPath = backupExistingOut();
  if (backupPath) console.log('Бэкап предыдущего data.js -> ' + backupPath);
  const html = fs.readFileSync(SRC, 'utf8');
  const tbody = extractTbody(html);
  const built = buildGrid(tbody);
  const grid = built.grid;
  const sheetRows = built.sheetRows;
  const detected = detectColumns(grid);
  const IDX = detected.found;
  const colNotes = detected.notes;

  const warnings = [];
  const collisions = [];
  const infos = [];
  const stats = {
    rows: grid.length,
    dataRows: 0,
    skippedMachine: 0,
    skippedNoAB: 0,
    skippedDistance: 0,
    skippedTime: 0,
    skippedHeads: 0,
    skippedNoProduct: 0,
    skippedCollision: 0,
  };

  // Для report.js: исключённые строки и «попало в базу, но проверьте».
  const excluded = [];
  const attention = [];
  const productsInSheet = new Set();

  const products = [];
  let currentProductName = null;
  let currentProduct = null;
  let seenDataRow = false;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    const fileName = textOrNull(row[IDX.fileName]);
    if (!fileName) continue;
    const machine = parseMachine(row[IDX.machine]);
    const productName = textOrNull(row[IDX.product]);
    const sheetRow = sheetRows[r];
    const ctx = 'стр. ' + sheetRow + ' | ' + fileName;
    const raw = (key) => textOrNull(row[IDX[key]]) || '';
    const values = () => ({
      product: productName || currentProductName || '',
      parts: raw('parts'),
      fileName: fileName,
      machine: raw('machine'),
      distance: raw('distance'),
      heads: raw('heads'),
      abTime: raw('abTime'),
      time: raw('time'),
    });
    // kind: empty — не заполнено (в т.ч. время 0:00:00 от формулы), bad — заполнено неверно.
    const exclude = (issues) => excluded.push({
      sheetRow: sheetRow,
      values: values(),
      issues: issues.map((i) => Object.assign({ kind: raw(i.field) ? 'bad' : 'empty' }, i)),
    });

    // До первой строки-данных файл без номера станка — это шапка/пояснения таблицы.
    if (machine == null) {
      if (!seenDataRow) continue;
      if (productName) currentProductName = productName;
      stats.skippedMachine++;
      exclude([{ field: 'machine', msg: raw('machine') ? 'номер станка должен быть числом' : 'не указан номер станка' }]);
      warnings.push('номер станка не число (' + row[IDX.machine] + ') — пропуск. ' + ctx);
      continue;
    }
    seenDataRow = true;
    stats.dataRows++;

    if (productName) currentProductName = productName;
    if (currentProductName) productsInSheet.add(currentProductName);

    // Собираем ВСЕ проблемы строки, чтобы мастер исправил их за один раз.
    const issues = [];

    const abSec = parseTime(row[IDX.abTime]);
    const abOk = abSec != null && abSec > 0;
    if (!abOk) {
      issues.push(abSec == null && raw('abTime')
        ? { field: 'abTime', msg: 'время резки не распознано — нужен формат ч:мм:сс' }
        : { field: 'abTime', msg: 'не заполнено время резки', kind: 'empty' });
    }

    const heads = parseHeads(row[IDX.heads]);
    const headsOk = heads != null && VALID_HEADS.indexOf(heads) !== -1;
    if (!headsOk) issues.push({ field: 'heads', msg: raw('heads') ? 'количество голов должно быть 2 или 4' : 'не указано количество голов' });

    const distRes = parseDistance(row[IDX.distance]);
    if (!distRes.ok) {
      const distMsg = {
        empty: 'не указано расстояние',
        spaces: 'пробел внутри числа — уберите пробелы (формат: 75,5)',
        chars: 'лишние символы — нужно только число, например 75,5',
        nan: 'расстояние не распознано',
      };
      issues.push({ field: 'distance', msg: distMsg[distRes.reason] });
    }

    const timeSec = parseTime(row[IDX.time]);
    if (abOk && (timeSec == null || timeSec === 0)) {
      issues.push(timeSec == null && raw('time')
        ? { field: 'time', msg: 'итоговое время не распознано — нужен формат ч:мм:сс' }
        : { field: 'time', msg: 'не заполнено итоговое время', kind: 'empty' });
    }

    if (!currentProductName) issues.push({ field: 'product', msg: 'не указано изделие' });

    if (issues.length) {
      exclude(issues);
      const first = issues[0].field;
      if (first === 'abTime') { stats.skippedNoAB++; continue; }
      if (first === 'heads') stats.skippedHeads++;
      else if (first === 'distance') stats.skippedDistance++;
      else if (first === 'time') stats.skippedTime++;
      else stats.skippedNoProduct++;
      warnings.push(issues.map((i) => i.msg + ' [' + colLetter(IDX[i.field]) + ': ' + (row[IDX[i.field]] || '') + ']').join('; ') + ' — пропуск. ' + ctx);
      continue;
    }

    const distance = distRes.value;

    if (distance > 1000) {
      warnings.push('подозрительно большое расстояние ' + distance + ' см — проверьте источник. ' + ctx);
      attention.push({ sheetRow: sheetRow, values: values(), field: 'distance', msg: 'подозрительно большое расстояние: ' + distance + ' см' });
    }

    if (/^итого/i.test(currentProductName)) {
      attention.push({ sheetRow: sheetRow, values: values(), field: 'product', msg: 'файл стоит в строке «Итого» — в базе он попал в отдельное изделие с этим названием' });
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
      file = { fileName: fileName, fileDescription: null, headsMap: {}, descRow: null };
      currentProduct.files.push(file);
    }

    const descRaw = textOrNull(row[IDX.parts]);
    if (descRaw) {
      if (file.fileDescription == null) {
        file.fileDescription = descRaw;
        file.descRow = sheetRow;
      } else if (file.fileDescription !== descRaw) {
        infos.push('разное описание у ' + fileName + ': оставлено ' + file.fileDescription + ', проигнорировано ' + descRaw + '. ' + ctx);
        attention.push({ sheetRow: sheetRow, values: values(), field: 'parts', msg: 'другое описание, чем в стр. ' + file.descRow + ' («' + file.fileDescription + '») — в базе оставлено первое' });
      }
    }

    const key = String(heads);
    if (file.headsMap[key] == null) {
      file.headsMap[key] = { distanceCm: distance, timeSec: timeSec, sheetRow: sheetRow };
    } else {
      const ex = file.headsMap[key];
      if (ex.distanceCm !== distance || ex.timeSec !== timeSec) {
        stats.skippedCollision++;
        collisions.push('коллизия ' + fileName + ' heads=' + key + ': оставлено d=' + ex.distanceCm + ' t=' + ex.timeSec + ', проигнорировано d=' + distance + ' t=' + timeSec + '. ' + ctx);
        const dup = [];
        if (ex.distanceCm !== distance) dup.push({ field: 'distance', msg: 'расстояние отличается от стр. ' + ex.sheetRow + ' (в базе ' + ex.distanceCm + ' см)' });
        if (ex.timeSec !== timeSec) dup.push({ field: 'time', msg: 'время отличается от стр. ' + ex.sheetRow + ' (в базе ' + formatHms(ex.timeSec) + ')' });
        exclude(dup);
      }
    }
  }

  for (const p of products) {
    for (const f of p.files) {
      const heads = {};
      for (const h of VALID_HEADS) {
        const key = String(h);
        const hm = f.headsMap[key];
        heads[key] = hm ? { distanceCm: hm.distanceCm, timeSec: hm.timeSec } : { distanceCm: 0, timeSec: 0 };
      }
      f.heads = heads;
      if (f.fileDescription == null) f.fileDescription = DEFAULT_DESC;
      delete f.headsMap;
      delete f.descRow;
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

  // ---------- report.js ----------

  // Одно имя файла в разных изделиях (в таблице это запрещено пояснением к столбцу P).
  const byFile = new Map();
  for (const p of products) for (const f of p.files) {
    if (!byFile.has(f.fileName)) byFile.set(f.fileName, []);
    if (byFile.get(f.fileName).indexOf(p.product) === -1) byFile.get(f.fileName).push(p.product);
  }
  const sharedFiles = [...byFile].filter(([, list]) => list.length > 1).map(([fileName, list]) => ({ fileName: fileName, products: list }));

  const inData = new Set(products.flatMap((p) => p.files.map((f) => fileKey(p.product, f.fileName))));
  const productsInData = new Set(products.map((p) => p.product));
  const missingFiles = new Set(excluded
    .map((e) => fileKey(e.values.product, e.values.fileName))
    .filter((k) => !inData.has(k)));

  const allFiles = products.flatMap((p) => p.files);
  const has = (f, h) => f.heads[h].timeSec > 0;
  const srcStat = fs.statSync(SRC);

  const columns = {};
  for (const key of Object.keys(HEADER_NAMES)) {
    columns[key] = { letter: colLetter(IDX[key]), header: detected.headers[key] || HEADER_NAMES[key][0] };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceModifiedAt: srcStat.mtime.toISOString(),
    backupFile: backupPath ? path.basename(backupPath) : null,
    columns: columns,
    stats: {
      products: products.length,
      files: totalFiles,
      files2: allFiles.filter((f) => has(f, '2')).length,
      files4: allFiles.filter((f) => has(f, '4')).length,
      filesBoth: allFiles.filter((f) => has(f, '2') && has(f, '4')).length,
      sheetRowsWithFile: stats.dataRows + stats.skippedMachine,
      excludedRows: excluded.length,
      missingFiles: missingFiles.size,
      missingProducts: [...productsInSheet].filter((p) => !productsInData.has(p)),
    },
    excluded: groupRows(excluded),
    attention: groupRows(attention),
    sharedFiles: sharedFiles,
    changes: diffData(prevData, products),
  };

  fs.writeFileSync(REPORT_JS,
    '// report.js — АВТОГЕНЕРАЦИЯ скриптом parse.js вместе с data.js. Не редактировать вручную.\n' +
    '// Показывается на странице report.html: что не попало в базу и почему, статистика обновления.\n\n' +
    'const REPORT = ' + JSON.stringify(report, null, 2) + ';\n\n' +
    "if (typeof module !== 'undefined' && module.exports) { module.exports = REPORT; }\n", 'utf8');

  const L = [];
  L.push('=== ОТЧЁТ ПАРСЕРА source/sheet.html ===');
  L.push('Сгенерировано: ' + report.generatedAt);
  L.push('Бэкап предыдущего data.js: ' + (backupPath ? path.basename(backupPath) : 'нет (файл не существовал)'));
  L.push('Наглядная версия отчёта: report.html');
  L.push('');
  L.push('-- Определение столбцов --');
  if (colNotes.length === 0) L.push('  все столбцы найдены по заголовкам на ожидаемых индексах.');
  colNotes.forEach((n) => L.push('  ' + n));
  L.push('  итоговые индексы: ' + JSON.stringify(IDX));
  L.push('');
  L.push('-- Счётчики --');
  L.push('  строк в сетке: ' + stats.rows);
  L.push('  строк-данных (файл+станок): ' + stats.dataRows);
  L.push('  изделий: ' + products.length);
  L.push('  файлов: ' + totalFiles);
  L.push('');
  L.push('-- Пропуски строк с файлом (по первой причине) --');
  L.push('  номер станка не число: ' + stats.skippedMachine);
  L.push('  AB-гейт (нет времени резки): ' + stats.skippedNoAB);
  L.push('  голова не 2/4: ' + stats.skippedHeads);
  L.push('  расстояние-брак: ' + stats.skippedDistance);
  L.push('  AD-время брак: ' + stats.skippedTime);
  L.push('  нет изделия: ' + stats.skippedNoProduct);
  L.push('  коллизия (дубль с другими значениями): ' + stats.skippedCollision);
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
  console.log('Отчёт  -> ' + REPORT + ', ' + REPORT_JS);
  console.log('Изделий: ' + products.length + ' | файлов: ' + totalFiles);
  console.log('Пропуски: станок ' + stats.skippedMachine + ' | AB ' + stats.skippedNoAB + ' | голова ' + stats.skippedHeads + ' | расст ' + stats.skippedDistance + ' | время ' + stats.skippedTime + ' | изд ' + stats.skippedNoProduct + ' | дубль ' + stats.skippedCollision);
  console.log('Коллизий: ' + collisions.length + ' | предупреждений: ' + warnings.length + ' | инфо: ' + infos.length);
}

main();
