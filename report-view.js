// report-view.js — страница report.html: справочник по заполнению исходной таблицы
// и отчёт последнего парса. Данные: глобальный REPORT из report.js (пишет parse.js).

'use strict';

const $ = id => document.getElementById(id);
const HAS_REPORT = typeof REPORT !== 'undefined';

// Буквы столбцов — из последнего парса (парсер ищет столбцы по заголовкам); иначе стандартные.
const DEFAULT_COLUMNS = {
    product: { letter: 'A', header: 'Изделие' },
    parts: { letter: 'O', header: 'перечень деталей' },
    fileName: { letter: 'P', header: 'Название файла' },
    machine: { letter: 'Q', header: 'номер станка' },
    distance: { letter: 'R', header: 'Расстояние между головами см.' },
    heads: { letter: 'U', header: 'количество голов' },
    abTime: { letter: 'AB', header: 'время резки (часы:мин.:сек.)' },
    time: { letter: 'AD', header: 'Итого время на файл' },
};
const COLUMNS = HAS_REPORT ? REPORT.columns : DEFAULT_COLUMNS;

const FIELDS = [
    { key: 'product', req: true, short: 'Изделие',
        what: 'Название изделия — одна объединённая ячейка на все строки изделия',
        ok: ['медальница фанера Баскетбол'], bad: ['пусто'], res: 'строка не попадёт в базу' },
    { key: 'parts', req: false, short: 'Детали',
        what: 'Какие детали вырезаются этим файлом',
        ok: ['медальница целиком'], bad: ['пусто'], res: 'попадёт, детали: «не указано»', soft: true },
    { key: 'fileName', req: true, short: 'Файл',
        what: 'Имя файла. Не повторять в разных изделиях',
        ok: ['BASKET'], bad: ['пусто'], res: 'строка не считается файлом' },
    { key: 'machine', req: true, short: 'Станок',
        what: 'Номер станка — только число',
        ok: ['4'], bad: ['пусто', '4-й'], res: 'строка не попадёт в базу' },
    { key: 'distance', req: true, short: 'Расст., см',
        what: 'Расстояние в см: только число, дробная часть через запятую, без пробелов',
        ok: ['75,5', '81'], bad: ['45 800,00', '75,5 см'], res: 'строка не попадёт в базу' },
    { key: 'heads', req: true, short: 'Голов',
        what: 'Только 2 или 4. Для 2 и для 4 голов — отдельные строки одного файла',
        ok: ['2', '4'], bad: ['3', 'пусто'], res: 'строка не попадёт в базу' },
    { key: 'abTime', req: true, short: 'Время резки',
        what: 'Время резки в формате ч:мм:сс, больше нуля',
        ok: ['0:09:29'], bad: ['пусто', '0:00:00'], res: 'не попадёт: файл считается не просчитанным' },
    { key: 'time', req: true, short: 'Итого время',
        what: 'Итого время на файл ч:мм:сс (резка + смена листов) — именно оно идёт в расчёт задания',
        ok: ['0:12:29'], bad: ['пусто', '0:00:00'], res: 'строка не попадёт в базу' },
];

// Пример для блока «как выглядит правильно»: один файл, строки для 2 и 4 голов.
const SAMPLE = {
    rows: [41, 42],
    values: [
        { product: 'медальница фанера Баскетбол', parts: 'медальница целиком', fileName: 'BASKET', machine: '1', distance: '81', heads: '2', abTime: '1:10:48', time: '1:13:48' },
        { product: '', parts: 'медальница целиком', fileName: 'BASKET', machine: '1', distance: '40,5', heads: '4', abTime: '0:36:10', time: '0:39:10' },
    ],
};

// --- утилиты ---

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function plural(n, one, few, many) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
}

const pad2 = n => String(n).padStart(2, '0');

function formatDateTime(iso) {
    const d = new Date(iso);
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} в ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function colIndex(letter) {
    return [...letter].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

const colBadge = key => `<span class="col-badge">${COLUMNS[key].letter}</span>`;

function valueChip(v, kind) {
    const empty = v === 'пусто';
    return `<code class="chip chip-${kind}${empty ? ' chip-empty' : ''}">${escapeHtml(v)}</code>`;
}

// --- 1. Справочник ---

function renderGuide() {
    $('guideRows').innerHTML = FIELDS.map(f => `
        <tr>
            <td class="g-col">${colBadge(f.key)}</td>
            <td class="g-name">${escapeHtml(COLUMNS[f.key].header)}</td>
            <td class="g-req">${f.req ? '<span class="req req-on">обязательно</span>' : '<span class="req">по желанию</span>'}</td>
            <td>${escapeHtml(f.what)}</td>
            <td class="g-ex">${f.ok.map(v => valueChip(v, 'ok')).join(' ')}</td>
            <td class="g-ex">${f.bad.map(v => valueChip(v, 'bad')).join(' ')}</td>
            <td class="g-res${f.soft ? '' : ' g-res-bad'}">${escapeHtml(f.res)}</td>
        </tr>`).join('');

    // Мини-таблица «как в Google Таблице»: только нужные столбцы, пропуски — «…».
    const keys = FIELDS.map(f => f.key).sort((a, b) => colIndex(COLUMNS[a].letter) - colIndex(COLUMNS[b].letter));
    const cols = [];
    keys.forEach((k, i) => {
        if (i && colIndex(COLUMNS[k].letter) - colIndex(COLUMNS[keys[i - 1]].letter) > 1) cols.push(null);
        cols.push(k);
    });
    const head = `<tr><th class="sh-corner"></th>${cols.map(k => k ? `<th>${COLUMNS[k].letter}</th>` : '<th class="sh-gap">…</th>').join('')}</tr>`;
    const titles = `<tr class="sh-titles"><th class="sh-row"></th>${cols.map(k => k ? `<td>${escapeHtml(FIELDS.find(f => f.key === k).short)}</td>` : '<td class="sh-gap"></td>').join('')}</tr>`;
    const body = SAMPLE.values.map((v, r) => `<tr><th class="sh-row">${SAMPLE.rows[r]}</th>${cols.map(k => {
        if (!k) return '<td class="sh-gap"></td>';
        if (k === 'product') return r === 0 ? `<td rowspan="${SAMPLE.values.length}" class="sh-merged">${escapeHtml(v[k])}</td>` : '';
        return `<td class="${k === 'fileName' ? 'sh-file' : ''}">${escapeHtml(v[k])}</td>`;
    }).join('')}</tr>`).join('');
    $('sampleSheet').innerHTML = `<thead>${head}</thead><tbody>${titles}${body}</tbody>`;
}

// --- 2. Статистика ---

function tile(value, label, note) {
    return `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${label}</div>${note ? `<div class="tile-note">${note}</div>` : ''}</div>`;
}

function changeList(title, items, fmt) {
    if (!items.length) return '';
    const shown = items.slice(0, 12).map(fmt).join('');
    const more = items.length > 12 ? `<li class="muted">и ещё ${items.length - 12}</li>` : '';
    return `<div class="change"><div class="change-title">${title}: <b>${items.length}</b></div><ul>${shown}${more}</ul></div>`;
}

function renderStats() {
    const s = REPORT.stats;
    $('parseDate').textContent = `Таблица скачана ${formatDateTime(REPORT.sourceModifiedAt)}`;

    const fileLi = f => `<li><span class="file-name">${escapeHtml(f.fileName)}</span> <span class="muted">— ${escapeHtml(f.product)}</span></li>`;
    const productLi = p => `<li>${escapeHtml(p)}</li>`;
    const c = REPORT.changes;
    let changes;
    if (!c) {
        changes = '<p class="muted">Предыдущей базы не было — сравнивать не с чем.</p>';
    } else {
        changes = [
            changeList('Новые изделия', c.addedProducts, productLi),
            changeList('Пропали изделия', c.removedProducts, productLi),
            changeList('Новые файлы', c.addedFiles, fileLi),
            changeList('Пропали файлы', c.removedFiles, fileLi),
            changeList('Изменилось время или расстояние', c.changedFiles, fileLi),
        ].join('') || '<p class="muted">Без изменений — база совпадает с предыдущей.</p>';
    }

    $('statsBlock').innerHTML = `
        <div class="updated">База обновлена <b>${formatDateTime(REPORT.generatedAt)}</b></div>
        <div class="tiles">
            ${tile(s.products, 'изделий в базе')}
            ${tile(s.files, 'файлов (деталей) в базе')}
            ${tile(s.files2, 'файлов с данными для 2 голов')}
            ${tile(s.files4, 'файлов с данными для 4 голов', s.filesBoth ? `из них ${s.filesBoth} — и для 2, и для 4` : '')}
            ${tile(s.sheetRowsWithFile, 'строк с файлом в таблице', `из них не попали в базу: <b class="${s.excludedRows ? 'warn-text' : ''}">${s.excludedRows}</b>`)}
        </div>
        <div class="stats-cols">
            <div>
                <h3>Изделия, которых нет в базе совсем</h3>
                ${s.missingProducts.length
                    ? `<p class="muted">Все строки этих изделий не прошли проверку — их нельзя выбрать в задании (только ручным вводом).</p><ul class="chips-list">${s.missingProducts.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
                    : '<p class="muted">Нет — в базе есть хотя бы один файл каждого изделия.</p>'}
                ${s.missingFiles ? `<p class="muted">Файлов, которых нет в базе ни для 2, ни для 4 голов: <b>${s.missingFiles}</b> — см. таблицу ниже.</p>` : ''}
            </div>
            <div>
                <h3>Изменения с прошлого обновления</h3>
                ${changes}
            </div>
        </div>`;
}

// --- 3. Не попало в базу ---

const EXCLUDED_COLS = ['product', 'parts', 'fileName', 'machine', 'distance', 'heads', 'abTime', 'time'];

function renderExcluded() {
    const list = REPORT.excluded;
    if (!list.length) {
        $('excludedBlock').innerHTML = '<div class="empty-state ok-state">Всё в порядке: все строки с файлами попали в базу.</div>';
        return;
    }
    const head = EXCLUDED_COLS.map(k => `<th class="x-${k}">${colBadge(k)} ${escapeHtml(FIELDS.find(f => f.key === k).short)}</th>`).join('');
    const rows = list.map(e => {
        const issues = Object.fromEntries(e.issues.map(i => [i.field, i]));
        const cells = EXCLUDED_COLS.map(k => {
            const v = e.values[k];
            const issue = issues[k];
            if (!issue) return `<td class="x-${k}${k === 'fileName' ? ' file-name' : ''}">${escapeHtml(v) || '<span class="muted">—</span>'}</td>`;
            return `<td class="x-${k} cell-${issue.kind}" title="${escapeHtml(issue.msg)}">${v ? escapeHtml(v) : 'пусто'}</td>`;
        }).join('');
        const fix = e.issues.map(i => `<li>${colBadge(i.field)} ${escapeHtml(i.msg)}</li>`).join('');
        return `<tr><td class="x-row num">${e.sheetRows.join(', ')}</td>${cells}<td class="x-fix"><ul>${fix}</ul></td></tr>`;
    }).join('');
    const rowsCount = list.reduce((n, e) => n + e.sheetRows.length, 0);
    $('excludedBlock').innerHTML = `
        <p class="block-note">${list.length} ${plural(list.length, 'позиция', 'позиции', 'позиций')} (${rowsCount} ${plural(rowsCount, 'строка', 'строки', 'строк')} таблицы).
            Одинаковые строки одного файла на разных станках объединены. Номер строки — как в Google Таблице.</p>
        <div class="table-wrap">
            <table class="data-table report-table">
                <thead><tr><th class="x-row">Строка</th>${head}<th class="x-fix">Что исправить</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// --- 4. Попало, но проверьте ---

function renderAttention() {
    const parts = [];
    if (REPORT.attention.length) {
        parts.push(`
            <div class="table-wrap">
                <table class="data-table report-table attention-table">
                    <thead><tr><th class="x-row">Строка</th><th>Изделие</th><th class="x-fileName">Файл</th><th>Что не так</th></tr></thead>
                    <tbody>${REPORT.attention.map(a => `
                        <tr>
                            <td class="x-row num">${a.sheetRows.join(', ')}</td>
                            <td>${escapeHtml(a.values.product)}</td>
                            <td class="file-name">${escapeHtml(a.values.fileName)}</td>
                            <td>${colBadge(a.field)} ${escapeHtml(a.msg)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`);
    }
    if (REPORT.sharedFiles.length) {
        parts.push(`
            <h3 class="sub-head">${colBadge('fileName')} Одно имя файла в нескольких изделиях</h3>
            <p class="block-note">В таблице сказано не повторять имя файла в разных изделиях. Если файл действительно общий (например, подложка) — всё в порядке.</p>
            <div class="table-wrap">
                <table class="data-table report-table attention-table">
                    <thead><tr><th class="x-fileName">Файл</th><th class="x-count">Изделий</th><th>В каких изделиях</th></tr></thead>
                    <tbody>${REPORT.sharedFiles.map(f => `
                        <tr>
                            <td class="file-name">${escapeHtml(f.fileName)}</td>
                            <td class="num">${f.products.length}</td>
                            <td>${f.products.map(escapeHtml).join('<span class="sep"> · </span>')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`);
    }
    $('attentionBlock').innerHTML = parts.join('') || '<div class="empty-state ok-state">Замечаний нет.</div>';
}

// --- ИНИЦИАЛИЗАЦИЯ ---

renderGuide();
if (HAS_REPORT) {
    renderStats();
    renderExcluded();
    renderAttention();
} else {
    const msg = '<div class="empty-state">Отчёт ещё не сформирован — запустите <code>node parse.js</code> (появится файл report.js).</div>';
    ['statsBlock', 'excludedBlock', 'attentionBlock'].forEach(id => { $(id).innerHTML = msg; });
}
