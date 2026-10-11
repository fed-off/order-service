// app.js — формирование сменного задания лазерной резки.
// Данные: глобальный DATA из data.js (изделие -> файлы -> heads {2|4: {distanceCm, timeSec}}).
// Всё состояние живёт в памяти страницы; расчёты, поиск и печать — на клиенте.

'use strict';

const MACHINE_COUNT = 9;
const HEAD_OPTIONS = ['2', '4'];

// Плоский список файлов (деталей) для поиска. key уникален: одно имя файла
// встречается в разных изделиях (напр. podlozh).
const ITEMS = DATA.flatMap(p => p.files.map((f, i) => ({
    key: `${p.id}/${i}`,
    product: p.product,
    fileName: f.fileName,
    fileDescription: f.fileDescription,
    heads: f.heads,
    haystack: normalize(`${p.product} ${f.fileName} ${f.fileDescription}`),
})));

// Сменное задание: { machineId: [ { item, heads, runs } ] }
const machineJobs = {};
let selectedItem = null;
let activeIndex = -1;   // подсвеченный пункт в выпадающем списке
let visibleItems = [];  // пункты списка в порядке отображения
let lastRemoved = null; // для «Отменить» после удаления
let manualMode = false; // в превью — поля ручного ввода вместо значений из базы
let manualBase = null;  // позиция из базы, взятая за основу ручной правки (null — ввод с нуля)
let manualDirty = false; // мастер уже менял поля — не перезаполнять их при смене кол-ва голов

// --- DOM ---

const $ = id => document.getElementById(id);

const shiftDate = $('shiftDate');
const operatorName = $('operatorName');
const machineSelect = $('machineSelect');
const searchInput = $('fileSearch');
const searchClear = $('searchClear');
const searchResults = $('searchResults');
const runsInput = $('runsInput');
const addBtn = $('addBtn');
const preview = $('preview');
const previewMsg = $('previewMsg');
const jobsContainer = $('jobsContainer');
const summary = $('summary');
const printBtn = $('printBtn');
const clearBtn = $('clearBtn');
const toast = $('toast');
const manualBtn = $('manualBtn');
const previewTitle = $('previewTitle');
const mFields = {
    product: $('mProduct'),
    fileName: $('mFile'),
    desc: $('mDesc'),
    distance: $('mDistance'),
    time: $('mTime'),
};

// --- УТИЛИТЫ ---

function normalize(s) {
    return String(s).toLowerCase().replace(/ё/g, 'е');
}

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

/** Секунды -> «чч:мм:сс» (часы не ограничены 24 — загрузка станка может быть больше суток). */
function formatDuration(sec) {
    const s = Math.round(sec);
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s % 3600 / 60))}:${pad2(s % 60)}`;
}

/** Поле времени «чч[:мм[:сс]]» -> секунды (недостающие минуты/секунды — нули); иначе null. */
function parseDuration(value) {
    const s = String(value).trim().replace(/:$/, '');
    if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(s)) return null;
    const [h, m = 0, sec = 0] = s.split(':').map(Number);
    if (m > 59 || sec > 59) return null;
    return h * 3600 + m * 60 + sec;
}

/**
 * Маска «чч:мм:сс»: цифры раскладываются по группам из двух, «:» подставляется сам
 * (при вводе следующей цифры — чтобы Backspace не упирался в двоеточие).
 * Введённое вручную «:» закрывает группу: «1:5» -> «01:05»; вставка «1:05:00» тоже понимается.
 */
function maskDuration(raw) {
    const groups = [''];
    for (const ch of String(raw)) {
        const last = groups.length - 1;
        if (/\d/.test(ch)) {
            if (groups[last].length === 2) {
                if (groups.length === 3) break;
                groups.push('');
            }
            groups[groups.length - 1] += ch;
        } else if (ch === ':' && groups[last] && groups.length < 3) {
            groups[last] = groups[last].padStart(2, '0');
            groups.push('');
        }
    }
    // Пустая последняя группа бывает только после введённого «:» — оставляем его («01:»).
    return groups.join(':');
}

/** Расстояние из поля: пусто -> 0 (нет данных), «75,5» / «75.5» -> число, иначе null. */
function parseDistanceInput(value) {
    const s = String(value).trim();
    if (!s) return 0;
    return /^\d+([.,]\d+)?$/.test(s) ? parseFloat(s.replace(',', '.')) : null;
}

function formatDistance(cm) {
    return cm ? `${cm.toLocaleString('ru-RU')} см` : '—';
}

function formatDateTime(date) {
    return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDate(iso) {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
}

function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Данные файла для выбранного кол-ва голов или null, если их нет (0 в базе). */
function headData(item, heads) {
    const h = item.heads[heads];
    return h && h.timeSec > 0 ? h : null;
}

function availableHeads(item) {
    return HEAD_OPTIONS.filter(h => headData(item, h));
}

function currentHeads() {
    return document.querySelector('input[name="heads"]:checked').value;
}

function setHeads(value) {
    document.querySelector(`input[name="heads"][value="${value}"]`).checked = true;
    onParamsChange();
}

function currentMachine() {
    return machineSelect.value;
}

/** Кол-во запусков из поля или null, если введено не целое число >= 1. */
function parseRuns(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : null;
}

function jobTimeSec(job) {
    return job.runs * headData(job.item, job.heads).timeSec;
}

function machineTimeSec(machineId) {
    return (machineJobs[machineId] || []).reduce((sum, j) => sum + jobTimeSec(j), 0);
}

function sortedMachineIds() {
    return Object.keys(machineJobs).sort((a, b) => a - b);
}

function fileCellHtml(name, desc) {
    return `<span class="file-name">${name}</span><span class="file-desc">${desc}</span>`;
}

const MANUAL_BADGE = '<span class="badge-manual" title="Параметры введены вручную — в базе их нет">вручную</span>';

let toastTimer = null;
function showToast(html, ms = 2600) {
    toast.innerHTML = html;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}

function restartAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}

// --- ПОИСК ---

/** Все токены запроса должны встретиться в «изделие + файл + описание». */
function searchItems(query) {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return { tokens, items: ITEMS };
    return { tokens, items: ITEMS.filter(it => tokens.every(t => it.haystack.includes(t))) };
}

/** Экранирует текст и оборачивает совпадения с токенами в <mark>. */
function highlight(text, tokens) {
    if (!tokens.length) return escapeHtml(text);
    const norm = normalize(text);
    const marks = new Array(text.length).fill(false);
    for (const t of tokens) {
        let i = norm.indexOf(t);
        while (i !== -1) {
            marks.fill(true, i, i + t.length);
            i = norm.indexOf(t, i + 1);
        }
    }
    let out = '', open = false;
    for (let i = 0; i < text.length; i++) {
        if (marks[i] !== open) {
            out += marks[i] ? '<mark>' : '</mark>';
            open = marks[i];
        }
        out += escapeHtml(text[i]);
    }
    return open ? out + '</mark>' : out;
}

function renderSearchResults() {
    const { tokens, items } = searchItems(searchInput.value);
    const heads = currentHeads();
    visibleItems = items;

    if (!items.length) {
        searchResults.innerHTML = '<div class="combo-empty">Ничего не найдено</div>';
        activeIndex = -1;
        openResults();
        return;
    }

    let html = '';
    let lastProduct = null;
    items.forEach((it, idx) => {
        if (it.product !== lastProduct) {
            html += `<div class="combo-group">${highlight(it.product, tokens)}</div>`;
            lastProduct = it.product;
        }
        const avail = availableHeads(it);
        const tags = HEAD_OPTIONS.map(h => {
            const on = avail.includes(h);
            const title = on ? `Есть данные для ${h} голов` : `Нет данных для ${h} голов`;
            return `<span class="tag${on ? ' on' : ''}${h === heads ? ' cur' : ''}" title="${title}">${h}Г</span>`;
        }).join('');
        const cls = [
            'combo-item',
            avail.includes(heads) ? '' : 'is-unavailable',
            selectedItem && selectedItem.key === it.key ? 'is-selected' : '',
        ].filter(Boolean).join(' ');
        html += `
            <div class="${cls}" role="option" data-idx="${idx}">
                <div class="file-cell">${fileCellHtml(highlight(it.fileName, tokens), highlight(it.fileDescription, tokens))}</div>
                <div class="tags">${tags}</div>
            </div>`;
    });
    searchResults.innerHTML = html;

    // По умолчанию подсвечиваем первый пункт, доступный для текущего кол-ва голов.
    const firstAvail = items.findIndex(it => headData(it, heads));
    setActive(tokens.length ? (firstAvail === -1 ? 0 : firstAvail) : -1);
    openResults();
}

function openResults() {
    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
}

function closeResults() {
    searchResults.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
}

function setActive(idx) {
    activeIndex = idx;
    searchResults.querySelectorAll('.combo-item').forEach(el => {
        el.classList.toggle('is-active', Number(el.dataset.idx) === idx);
    });
    const el = searchResults.querySelector(`.combo-item[data-idx="${idx}"]`);
    if (el) {
        // Не прячем активный пункт под «липким» заголовком группы.
        const group = el.previousElementSibling && el.previousElementSibling.classList.contains('combo-group')
            ? el.previousElementSibling : null;
        (group || el).scrollIntoView({ block: 'nearest' });
        el.scrollIntoView({ block: 'nearest' });
    }
}

function selectItem(item) {
    selectedItem = item;
    manualMode = false;
    manualBase = null;
    searchInput.value = `${item.fileName} — ${item.product}`;
    searchClear.hidden = false;
    closeResults();
    updatePreview();
    saveState();
    runsInput.focus();
    runsInput.select();
}

function clearSelection() {
    selectedItem = null;
    searchInput.value = '';
    searchClear.hidden = true;
    updatePreview();
}

searchInput.addEventListener('input', () => {
    selectedItem = null;
    searchClear.hidden = !searchInput.value;
    updatePreview();
    renderSearchResults();
});

// Программный фокус (после добавления) не раскрывает список, чтобы не перекрывать результат.
let quietFocus = false;
function focusSearchQuietly() {
    quietFocus = true;
    searchInput.focus();
    quietFocus = false;
}

searchInput.addEventListener('focus', () => {
    if (selectedItem) searchInput.select();
    else if (!quietFocus) renderSearchResults();
});

searchInput.addEventListener('click', () => {
    if (!selectedItem && searchResults.hidden) renderSearchResults();
});

searchInput.addEventListener('keydown', e => {
    const open = !searchResults.hidden;
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            if (!open) { renderSearchResults(); setActive(0); return; }
            if (visibleItems.length) setActive(Math.min(activeIndex + 1, visibleItems.length - 1));
            break;
        case 'ArrowUp':
            e.preventDefault();
            if (open && visibleItems.length) setActive(Math.max(activeIndex - 1, 0));
            break;
        case 'Enter':
            e.preventDefault();
            if (open && activeIndex >= 0 && visibleItems[activeIndex]) {
                selectItem(visibleItems[activeIndex]);
            } else if (selectedItem) {
                addJobToMachine();
            }
            break;
        case 'Escape':
            if (open) { e.preventDefault(); closeResults(); }
            break;
        case 'Tab':
            closeResults();
            break;
    }
});

// mousedown + preventDefault: фокус остаётся в поле, blur не закрывает список раньше клика.
searchResults.addEventListener('mousedown', e => {
    e.preventDefault();
    const el = e.target.closest('.combo-item');
    if (el) selectItem(visibleItems[Number(el.dataset.idx)]);
});

searchResults.addEventListener('mousemove', e => {
    const el = e.target.closest('.combo-item');
    if (el && Number(el.dataset.idx) !== activeIndex) setActive(Number(el.dataset.idx));
});

searchInput.addEventListener('blur', closeResults);

searchClear.addEventListener('click', () => {
    clearSelection();
    searchInput.focus();
});

// --- ПАРАМЕТРЫ: станок, головы, запуски ---

function renderMachineOptions() {
    const value = machineSelect.value || '1';
    let html = '';
    for (let i = 1; i <= MACHINE_COUNT; i++) {
        const sec = machineTimeSec(String(i));
        const load = sec > 0 ? ` · ${formatDuration(sec)}` : '';
        html += `<option value="${i}">Станок № ${i}${load}</option>`;
    }
    machineSelect.innerHTML = html;
    machineSelect.value = value;
}

function onParamsChange() {
    // Правка позиции из базы, поля ещё не трогали — подставляем данные для нового кол-ва голов.
    if (manualMode && manualBase && !manualDirty) fillDraft(manualBase);
    updatePreview();
    if (!searchResults.hidden) renderSearchResults();
    markCurrentMachine();
    saveState();
}

machineSelect.addEventListener('change', onParamsChange);
document.querySelectorAll('input[name="heads"]').forEach(r => r.addEventListener('change', onParamsChange));

runsInput.addEventListener('input', updatePreview);
runsInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addJobToMachine();
    }
});

document.querySelectorAll('.step-btn').forEach(btn => btn.addEventListener('click', () => {
    const cur = parseRuns(runsInput.value) || 0;
    runsInput.value = Math.max(1, cur + Number(btn.dataset.step));
    updatePreview();
}));

// --- ПРЕДПРОСМОТР ---

function setOutput(id, value, asHtml = false) {
    const el = $(id);
    const prev = el.innerHTML;
    if (asHtml) el.innerHTML = value; else el.textContent = value;
    if (el.innerHTML !== prev && preview.dataset.state !== 'empty') restartAnimation(el, 'is-changed');
}

function setMessage(html) {
    previewMsg.hidden = !html;
    previewMsg.innerHTML = html || '';
}

function loadChangeHtml(loadPrefix, loadNow, total) {
    return `${escapeHtml(loadPrefix)}${formatDuration(loadNow)}<span class="arrow">→</span><span class="after">${formatDuration(loadNow + total)}</span>`;
}

function updatePreview() {
    const machineId = currentMachine();
    const heads = currentHeads();
    const runs = parseRuns(runsInput.value);
    const loadNow = machineTimeSec(machineId);
    const loadPrefix = `Станок № ${machineId}: `;

    preview.dataset.mode = manualMode ? 'manual' : 'db';
    previewTitle.textContent = !manualMode ? 'Будет добавлено'
        : manualBase ? 'Ручная правка позиции из базы' : 'Ручной ввод — позиции нет в базе';
    manualBtn.textContent = manualMode ? 'Отменить ручной ввод'
        : selectedItem ? 'Изменить параметры' : 'Ввести вручную';

    if (manualMode) {
        updateManualPreview(machineId, heads, runs, loadNow, loadPrefix);
        return;
    }

    if (!selectedItem) {
        preview.dataset.state = 'empty';
        preview.querySelectorAll('.is-changed').forEach(el => el.classList.remove('is-changed'));
        setOutput('pvProduct', '—');
        setOutput('pvFile', fileCellHtml('—', ''), true);
        setOutput('pvDistance', '—');
        setOutput('pvRuns', runs ?? '—');
        setOutput('pvTimeOne', '—');
        setOutput('pvTimeTotal', '—');
        setOutput('pvLoad', loadPrefix + formatDuration(loadNow));
        setMessage(runs ? '' : 'Укажите количество запусков — целое число от 1.');
        addBtn.disabled = true;
        return;
    }

    const it = selectedItem;
    const hd = headData(it, heads);
    setOutput('pvProduct', it.product);
    setOutput('pvFile', fileCellHtml(escapeHtml(it.fileName), escapeHtml(it.fileDescription)), true);
    setOutput('pvRuns', runs ?? '—');

    if (!hd) {
        preview.dataset.state = 'warn';
        const other = availableHeads(it);
        setOutput('pvDistance', 'нет данных');
        setOutput('pvTimeOne', '—');
        setOutput('pvTimeTotal', '—');
        setOutput('pvLoad', loadPrefix + formatDuration(loadNow));
        setMessage(`Для файла <b>${escapeHtml(it.fileName)}</b> нет данных для ${heads} голов.` +
            other.map(h => ` <button type="button" class="link-btn" data-set-heads="${h}">Переключить на ${h} головы</button>`).join(''));
        addBtn.disabled = true;
        return;
    }

    preview.dataset.state = 'ready';
    setOutput('pvDistance', formatDistance(hd.distanceCm));
    setOutput('pvTimeOne', formatDuration(hd.timeSec));

    if (!runs) {
        setOutput('pvTimeTotal', '—');
        setOutput('pvLoad', loadPrefix + formatDuration(loadNow));
        setMessage('Укажите количество запусков — целое число от 1.');
        addBtn.disabled = true;
        return;
    }

    const total = runs * hd.timeSec;
    setOutput('pvTimeTotal', formatDuration(total));
    setOutput('pvLoad', loadChangeHtml(loadPrefix, loadNow, total), true);
    const existing = findJob(machineId, it, heads);
    setMessage(existing
        ? `Файл уже есть на станке № ${machineId} (${existing.runs} зап.) — запуски будут суммированы.`
        : '');
    addBtn.disabled = false;
}

previewMsg.addEventListener('click', e => {
    const btn = e.target.closest('[data-set-heads]');
    if (btn) setHeads(btn.dataset.setHeads);
});

// --- РУЧНОЙ ВВОД / ПРАВКА ПОЗИЦИИ ---
// Позиция, которой нет в базе (или с уникальными параметрами), задаётся прямо в превью.
// Время на файл — обязательное: от него считаются общее время и загрузка станка.

function fillDraft(item) {
    const hd = item && headData(item, currentHeads());
    mFields.product.value = item ? item.product : '';
    mFields.fileName.value = item ? item.fileName : '';
    mFields.desc.value = item ? item.fileDescription : '';
    mFields.distance.value = hd && hd.distanceCm ? String(hd.distanceCm).replace('.', ',') : '';
    mFields.time.value = hd ? formatDuration(hd.timeSec) : '';
}

/** Значения полей ручного ввода + список незаполненных/некорректных: [поле, подсказка]. */
function readDraft() {
    const d = {
        product: mFields.product.value.trim(),
        fileName: mFields.fileName.value.trim(),
        desc: mFields.desc.value.trim(),
        distanceCm: parseDistanceInput(mFields.distance.value),
        timeSec: parseDuration(mFields.time.value),
        invalid: [],
    };
    if (!d.product) d.invalid.push(['product', 'изделие']);
    if (!d.fileName) d.invalid.push(['fileName', 'имя файла']);
    if (d.distanceCm == null) d.invalid.push(['distance', 'расстояние — число, например 75,5']);
    if (!d.timeSec) d.invalid.push(['time', 'время на файл в формате чч:мм:сс']);
    return d;
}

/** Позиция для задания из полей. Ничего не изменили — возвращаем исходную позицию базы. */
function draftItem(d, heads) {
    const hd = manualBase && headData(manualBase, heads);
    if (hd && manualBase.product === d.product && manualBase.fileName === d.fileName &&
        manualBase.fileDescription === d.desc && hd.distanceCm === d.distanceCm && hd.timeSec === d.timeSec) {
        return manualBase;
    }
    return manualItem(d, heads);
}

function manualItem(d, heads) {
    return {
        // Одинаковые ручные позиции получают один ключ — запуски суммируются, как у позиций базы.
        key: 'manual:' + JSON.stringify([d.product, d.fileName, d.desc, d.distanceCm, d.timeSec]),
        product: d.product,
        fileName: d.fileName,
        fileDescription: d.desc,
        heads: { [heads]: { distanceCm: d.distanceCm, timeSec: d.timeSec } },
        manual: true,
    };
}

function updateManualPreview(machineId, heads, runs, loadNow, loadPrefix) {
    const d = readDraft();
    const item = d.invalid.length ? null : draftItem(d, heads);
    const total = d.timeSec && runs ? runs * d.timeSec : 0;

    preview.dataset.state = 'manual';
    setOutput('pvRuns', runs ?? '—');
    setOutput('pvTimeTotal', total ? formatDuration(total) : '—');
    setOutput('pvLoad', total ? loadChangeHtml(loadPrefix, loadNow, total) : loadPrefix + formatDuration(loadNow), true);

    // Красным — только введённое с ошибкой; пустые поля просто перечисляем в подсказке.
    mFields.distance.parentElement.classList.toggle('is-invalid', d.distanceCm == null);
    mFields.time.classList.toggle('is-invalid', !d.timeSec && mFields.time.value.trim() !== '');

    const missing = d.invalid.map(([, hint]) => hint);
    if (!runs) missing.push('количество запусков — целое число от 1');
    const existing = item && findJob(machineId, item, heads);
    setMessage(missing.length ? `Заполните: ${missing.join(', ')}.`
        : existing ? `Такая позиция уже есть на станке № ${machineId} (${existing.runs} зап.) — запуски будут суммированы.`
        : '');
    addBtn.disabled = !item || !runs;
}

function enterManual() {
    manualMode = true;
    manualBase = selectedItem;
    manualDirty = false;
    fillDraft(manualBase);
    closeResults();
    updatePreview();
    (manualBase ? mFields.time : mFields.product).focus();
}

function exitManual() {
    manualMode = false;
    manualBase = null;
    Object.values(mFields).forEach(el => { el.value = ''; });
    updatePreview();
    saveState();
}

manualBtn.addEventListener('click', () => {
    if (manualMode) {
        exitManual();
        searchInput.focus();
    } else {
        enterManual();
    }
});

Object.values(mFields).forEach(el => {
    el.addEventListener('input', () => {
        manualDirty = true;
        updatePreview();
    });
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addJobToMachine();
        } else if (e.key === 'Escape') {
            exitManual();
            searchInput.focus();
        }
    });
});

// Маска времени: после каждого ввода переформатируем и ставим курсор после того же числа цифр.
// Общий обработчик input полей сработал раньше, на неотформатированном значении, — пересчитываем превью.
function digitsBefore(value, pos) {
    return value.slice(0, pos).replace(/\D/g, '').length;
}

function caretAfterDigits(value, count) {
    if (!count) return 0;
    let seen = 0;
    for (let i = 0; i < value.length; i++) {
        if (/\d/.test(value[i]) && ++seen === count) return i + 1;
    }
    return value.length;
}

mFields.time.addEventListener('input', e => {
    const el = mFields.time;
    const caret = el.selectionStart;
    // Введённое «:» и вставка — с учётом двоеточий («1:5», «1:05:00»); обычный ввод и удаление —
    // только по цифрам, иначе оставшиеся «:» в середине строки сбивали бы раскладку.
    if (e.data === ':' || e.inputType === 'insertFromPaste') {
        el.value = maskDuration(el.value);
        const pos = Math.min(maskDuration(el.value.slice(0, caret)).length, el.value.length);
        el.setSelectionRange(pos, pos);
    } else {
        const digits = digitsBefore(el.value, caret);
        el.value = maskDuration(el.value.replace(/\D/g, ''));
        const pos = caretAfterDigits(el.value, digits);
        el.setSelectionRange(pos, pos);
    }
    updatePreview();
});

// Backspace сразу после «:» удаляет цифру перед ним, а не упирается в двоеточие.
mFields.time.addEventListener('keydown', e => {
    const el = mFields.time;
    const pos = el.selectionStart;
    if (e.key !== 'Backspace' || pos !== el.selectionEnd || el.value[pos - 1] !== ':') return;
    e.preventDefault();
    const keep = digitsBefore(el.value, pos) - 1; // цифр слева от курсора после удаления
    el.value = (el.value.slice(0, pos - 2) + el.value.slice(pos)).replace(/:/g, '');
    el.setSelectionRange(keep, keep);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

// «1:5» -> «01:05:00»: при уходе из поля видно, как время понято.
mFields.time.addEventListener('blur', () => {
    const sec = parseDuration(mFields.time.value);
    if (sec) mFields.time.value = formatDuration(sec);
});

// --- ЗАДАНИЕ ПО СТАНКАМ ---

function findJob(machineId, item, heads) {
    return (machineJobs[machineId] || []).find(j => j.item.key === item.key && j.heads === heads);
}

/** Позиция, которую добавит кнопка: из ручных полей или выбранная в базе; null — добавить нельзя. */
function pendingItem(heads) {
    if (manualMode) {
        const d = readDraft();
        return d.invalid.length ? null : draftItem(d, heads);
    }
    return selectedItem && headData(selectedItem, heads) ? selectedItem : null;
}

function addJobToMachine() {
    if (!manualMode && !selectedItem) {
        searchInput.focus();
        return;
    }
    const machineId = currentMachine();
    const heads = currentHeads();
    const runs = parseRuns(runsInput.value);
    const item = pendingItem(heads);
    if (!item || !runs) {
        updatePreview();
        if (manualMode) {
            const firstInvalid = readDraft().invalid[0];
            (firstInvalid ? mFields[firstInvalid[0]] : runsInput).focus();
        }
        return;
    }

    const existing = findJob(machineId, item, heads);
    let job;
    if (existing) {
        const before = existing.runs;
        existing.runs += runs;
        job = existing;
        showToast(`Станок № ${machineId}: <b>${escapeHtml(job.item.fileName)}</b> — запуски суммированы (${before} → ${job.runs})`);
    } else {
        job = { item, heads, runs };
        (machineJobs[machineId] = machineJobs[machineId] || []).push(job);
        showToast(`Добавлено на станок № ${machineId}: <b>${escapeHtml(job.item.fileName)}</b> × ${runs}${item.manual ? ' (вручную)' : ''}`);
    }

    // Станок и кол-во голов сохраняем — обычно на один станок назначают несколько файлов подряд.
    runsInput.value = 1;
    if (manualMode) {
        manualMode = false;
        manualBase = null;
        Object.values(mFields).forEach(el => { el.value = ''; });
    }
    clearSelection();
    renderJobs({ flashMachine: machineId, flashJob: job });
    focusSearchQuietly();
}

addBtn.addEventListener('click', addJobToMachine);

function removeJob(machineId, index) {
    const [job] = machineJobs[machineId].splice(index, 1);
    if (!machineJobs[machineId].length) delete machineJobs[machineId];
    lastRemoved = { machineId, index, job };
    renderJobs();
    showToast(`Удалено со станка № ${machineId}: <b>${escapeHtml(job.item.fileName)}</b>
        <button type="button" class="link-btn toast-undo" id="undoBtn">Отменить</button>`, 6000);
}

function undoRemove() {
    if (!lastRemoved) return;
    const { machineId, index, job } = lastRemoved;
    const list = (machineJobs[machineId] = machineJobs[machineId] || []);
    list.splice(Math.min(index, list.length), 0, job);
    lastRemoved = null;
    toast.hidden = true;
    renderJobs({ flashJob: job });
}

toast.addEventListener('click', e => {
    if (e.target.id === 'undoBtn') undoRemove();
});

function renderSummary() {
    const ids = sortedMachineIds();
    const count = ids.reduce((s, id) => s + machineJobs[id].length, 0);
    const total = ids.reduce((s, id) => s + machineTimeSec(id), 0);
    summary.innerHTML = ids.length
        ? `<span>Станков: <b>${ids.length}</b></span><span>Позиций: <b>${count}</b></span><span>Суммарно: <b>${formatDuration(total)}</b></span>`
        : '';
    printBtn.disabled = clearBtn.disabled = !ids.length;
}

function renderJobs({ flashMachine, flashJob } = {}) {
    const ids = sortedMachineIds();

    if (!ids.length) {
        jobsContainer.innerHTML = '<div class="empty-state">Задания ещё не добавлены. Выберите станок и изделие выше.</div>';
    } else {
        jobsContainer.innerHTML = ids.map(mId => {
            const rows = machineJobs[mId].map((job, idx) => {
                const hd = headData(job.item, job.heads);
                return `
                    <tr data-machine="${mId}" data-idx="${idx}">
                        <td class="c-idx">${idx + 1}</td>
                        <td>${escapeHtml(job.item.product)}</td>
                        <td><div class="file-cell">${fileCellHtml(escapeHtml(job.item.fileName) + (job.item.manual ? MANUAL_BADGE : ''), escapeHtml(job.item.fileDescription))}</div></td>
                        <td class="c-num num">${job.heads}</td>
                        <td class="c-num num">${formatDistance(hd.distanceCm)}</td>
                        <td class="c-runs"><input type="number" class="runs-edit" min="1" step="1" value="${job.runs}" aria-label="Кол-во запусков"></td>
                        <td class="c-num num">${formatDuration(hd.timeSec)}</td>
                        <td class="c-num num" data-role="job-total"><b>${formatDuration(jobTimeSec(job))}</b></td>
                        <td class="c-act"><button type="button" class="icon-btn" data-action="remove" title="Удалить">×</button></td>
                    </tr>`;
            }).join('');
            return `
                <div class="machine" data-machine="${mId}">
                    <div class="machine-head">
                        <span class="machine-badge">СТАНОК № ${mId}</span>
                        <span class="machine-total">Общее время занятости станка: <b data-role="machine-total">${formatDuration(machineTimeSec(mId))}</b></span>
                    </div>
                    <div class="table-wrap">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th class="c-idx">№</th>
                                    <th>Изделие</th>
                                    <th class="c-file">Имя файла</th>
                                    <th class="c-heads c-num">Голов</th>
                                    <th class="c-dist c-num">Расст. между головами</th>
                                    <th class="c-runs">Запусков</th>
                                    <th class="c-time c-num">Время на файл</th>
                                    <th class="c-total c-num">Общее время</th>
                                    <th class="c-act"></th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        }).join('');
    }

    renderSummary();
    renderMachineOptions();
    markCurrentMachine();
    updatePreview();
    saveState();

    if (flashMachine) {
        const card = jobsContainer.querySelector(`.machine[data-machine="${flashMachine}"]`);
        if (card) restartAnimation(card, 'flash');
    }
    if (flashJob) {
        for (const id of ids) {
            const idx = machineJobs[id].indexOf(flashJob);
            if (idx !== -1) {
                const row = jobsContainer.querySelector(`tr[data-machine="${id}"][data-idx="${idx}"]`);
                if (row) restartAnimation(row, 'flash');
            }
        }
    }
}

function markCurrentMachine() {
    const mId = currentMachine();
    jobsContainer.querySelectorAll('.machine').forEach(el => {
        el.classList.toggle('is-current', el.dataset.machine === mId);
    });
}

/** Точечное обновление итогов при правке запусков в таблице (без перерисовки — фокус не теряется). */
function refreshTotals(machineId, row, job) {
    row.querySelector('[data-role="job-total"]').innerHTML = `<b>${formatDuration(jobTimeSec(job))}</b>`;
    const card = jobsContainer.querySelector(`.machine[data-machine="${machineId}"]`);
    card.querySelector('[data-role="machine-total"]').textContent = formatDuration(machineTimeSec(machineId));
    renderSummary();
    renderMachineOptions();
    updatePreview();
}

jobsContainer.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    const row = btn.closest('tr');
    removeJob(row.dataset.machine, Number(row.dataset.idx));
});

jobsContainer.addEventListener('input', e => {
    if (!e.target.classList.contains('runs-edit')) return;
    const row = e.target.closest('tr');
    const job = machineJobs[row.dataset.machine][Number(row.dataset.idx)];
    const runs = parseRuns(e.target.value);
    if (runs) {
        job.runs = runs;
        refreshTotals(row.dataset.machine, row, job);
    }
});

// При уходе из поля возвращаем последнее корректное значение.
jobsContainer.addEventListener('change', e => {
    if (!e.target.classList.contains('runs-edit')) return;
    const row = e.target.closest('tr');
    e.target.value = machineJobs[row.dataset.machine][Number(row.dataset.idx)].runs;
});

jobsContainer.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('runs-edit')) e.target.blur();
});

clearBtn.addEventListener('click', () => {
    if (!confirm('Удалить все задания по всем станкам?')) return;
    Object.keys(machineJobs).forEach(k => delete machineJobs[k]);
    lastRemoved = null;
    renderJobs();
});

// --- ПОДГОТОВКА И ПЕЧАТЬ PDF ---
// Страницы A4 собираются здесь, а не браузером: так подписи столбцов печатаются один раз
// (на первой странице), у каждой страницы есть номер «Стр. N из M», а @page margin: 0
// по-прежнему отключает колонтитулы браузера. Разбивка — по замеренной высоте строк.

const PDF_COLS = [
    { title: 'Описание изделия', width: 27 },
    { title: 'Имя файла', width: 21 },
    { title: 'Расстояние между головами', width: 14 },
    { title: 'Кол-во запусков', width: 10 },
    { title: 'Запусков на начало смены', width: 14, cls: 'pdf-manual-cell' },
    { title: 'Запусков на конец смены', width: 14, cls: 'pdf-manual-cell' },
];
const PX_PER_MM = 96 / 25.4;
// Высота области таблицы: .pdf-page (296 мм) минус верхнее поле (12 мм), зона номера страницы
// (18 мм) и запас на округления при печати (3 мм) — значения синхронны со style.css.
const PDF_BODY_PX = (296 - 12 - 18 - 3) * PX_PER_MM;

function pdfTableHtml(rowsHtml, withLegend) {
    const cols = PDF_COLS.map(c => `<col style="width: ${c.width}%">`).join('');
    const legend = withLegend
        ? `<tr class="pdf-legend">${PDF_COLS.map(c => `<th${c.cls ? ` class="${c.cls}"` : ''}>${c.title}</th>`).join('')}</tr>`
        : '';
    return `<table class="pdf-table"><colgroup>${cols}</colgroup><tbody>${legend}${rowsHtml}</tbody></table>`;
}

function pdfBarHtml(mId, continued) {
    return `
        <tr class="pdf-bar">
            <td colspan="${PDF_COLS.length}">
                <span>СТАНОК № ${mId}${continued ? ' (продолжение)' : ''}</span>
                <span>ОБЩЕЕ ВРЕМЯ ЗАНЯТОСТИ СТАНКА: ${formatDuration(machineTimeSec(mId))}</span>
            </td>
        </tr>`;
}

/** Строки печатной таблицы по порядку: отступ между станками, плашка станка, позиции. */
function pdfBlocks() {
    const blocks = [];
    sortedMachineIds().forEach((mId, i) => {
        if (i) blocks.push({ type: 'gap', html: `<tr class="pdf-gap"><td colspan="${PDF_COLS.length}"></td></tr>` });
        blocks.push({ type: 'bar', machine: mId, html: pdfBarHtml(mId, false) });
        machineJobs[mId].forEach(job => blocks.push({
            type: 'item',
            machine: mId,
            html: `
                <tr>
                    <td class="pdf-left">${escapeHtml(job.item.product)}</td>
                    <td><div class="file-cell">${fileCellHtml(escapeHtml(job.item.fileName), escapeHtml(job.item.fileDescription))}</div></td>
                    <td>${formatDistance(headData(job.item, job.heads).distanceCm)}</td>
                    <td><strong>${job.runs}</strong></td>
                    <td class="pdf-manual-cell"></td>
                    <td class="pdf-manual-cell"></td>
                </tr>`,
        }));
    });
    return blocks;
}

/** Замер высот: всё содержимое верстается невидимо одной страницей нужной ширины. */
function measurePdf(headerHtml, blocks) {
    const box = document.createElement('div');
    box.className = 'pdf-sheet pdf-measure';
    box.innerHTML = `<section class="pdf-page">${headerHtml}${pdfTableHtml(blocks.map(b => b.html).join(''), true)}</section>`;
    document.body.appendChild(box);
    const rows = box.querySelectorAll('.pdf-table > tbody > tr');
    const contentTop = box.querySelector('.pdf-page').getBoundingClientRect().top + 12 * PX_PER_MM;
    const firstPageUsed = rows[0].getBoundingClientRect().bottom - contentTop; // шапка + подписи столбцов
    blocks.forEach((b, i) => { b.h = rows[i + 1].getBoundingClientRect().height; });
    box.remove();
    return firstPageUsed;
}

function paginatePdf(blocks, firstPageUsed) {
    const barHeight = (blocks.find(b => b.type === 'bar') || { h: 0 }).h;
    const pages = [[]];
    let used = firstPageUsed;
    blocks.forEach((b, i) => {
        let page = pages[pages.length - 1];
        // Отступ и плашка станка не остаются внизу страницы — переносятся вместе с первой позицией.
        let need = b.h;
        if (b.type === 'gap') need += blocks[i + 1].h + blocks[i + 2].h;
        if (b.type === 'bar') need += blocks[i + 1].h;
        if (used + need > PDF_BODY_PX && page.length) {
            pages.push(page = []);
            used = 0;
        }
        if (b.type === 'gap' && !page.length) return;
        // Станок продолжается на новой странице — повторяем его плашку с пометкой.
        if (b.type === 'item' && !page.length) {
            page.push({ type: 'bar', html: pdfBarHtml(b.machine, true) });
            used += barHeight;
        }
        page.push(b);
        used += b.h;
    });
    return pages;
}

function generatePDF() {
    const ids = sortedMachineIds();
    if (!ids.length) {
        alert('Нет данных для печати! Сначала добавьте хотя бы одно задание.');
        return;
    }

    const operator = operatorName.value.trim() || 'Не указан';
    const date = formatDate(shiftDate.value);
    const headerHtml = `
        <div class="pdf-header">
            <h2>СМЕННОЕ ЗАДАНИЕ НА ЛАЗЕРНУЮ РЕЗКУ</h2>
            <div class="pdf-meta">
                <span><strong>Оператор:</strong> ${escapeHtml(operator)}</span>
                <span><strong>Дата:</strong> ${date}</span>
            </div>
        </div>`;

    const blocks = pdfBlocks();
    const pages = paginatePdf(blocks, measurePdf(headerHtml, blocks));
    $('pdfArea').innerHTML = pages.map((page, i) => `
        <section class="pdf-page">
            ${i === 0 ? headerHtml : ''}
            ${pdfTableHtml(page.map(b => b.html).join(''), i === 0)}
            <footer class="pdf-footer">
                <span>Сменное задание · ${date} · ${escapeHtml(operator)}</span>
                <span>Стр. ${i + 1} из ${pages.length}</span>
            </footer>
        </section>`).join('');

    // Заголовок документа = имя PDF-файла по умолчанию при «Сохранить как PDF».
    const prevTitle = document.title;
    document.title = `Сменное задание ${date}${operator !== 'Не указан' ? ' ' + operator : ''}`;
    window.addEventListener('afterprint', () => { document.title = prevTitle; }, { once: true });

    window.print();
}

printBtn.addEventListener('click', generatePDF);

// --- СОХРАНЕНИЕ ПРОГРЕССА (localStorage) ---
// Задание, параметры смены и недописанный ручной ввод переживают перезагрузку и закрытие вкладки.
// Позиции хранятся снимком значений, а не индексом в data.js: после перепарса индексы меняются.
// Позиция базы при восстановлении ищется по изделию + имени файла; не нашлась — станет ручной.

const STORAGE_KEY = 'order-service:shift';
const STORAGE_VERSION = 1;

function itemSnapshot(item, heads) {
    const hd = headData(item, heads);
    return {
        product: item.product,
        fileName: item.fileName,
        desc: item.fileDescription,
        distanceCm: hd.distanceCm,
        timeSec: hd.timeSec,
        manual: !!item.manual,
    };
}

function findDbItem(product, fileName, heads) {
    return ITEMS.find(it => it.product === product && it.fileName === fileName && (!heads || headData(it, heads))) || null;
}

function restoreItem(snap, heads) {
    return (!snap.manual && findDbItem(snap.product, snap.fileName, heads)) || manualItem(snap, heads);
}

function saveState() {
    const state = {
        v: STORAGE_VERSION,
        date: shiftDate.value,
        operator: operatorName.value,
        machine: currentMachine(),
        heads: currentHeads(),
        runs: runsInput.value,
        jobs: sortedMachineIds().map(mId => ({
            machine: mId,
            items: machineJobs[mId].map(job => ({ heads: job.heads, runs: job.runs, item: itemSnapshot(job.item, job.heads) })),
        })),
        manual: manualMode ? {
            base: manualBase && { product: manualBase.product, fileName: manualBase.fileName },
            dirty: manualDirty,
            fields: Object.fromEntries(Object.entries(mFields).map(([k, el]) => [k, el.value])),
        } : null,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* хранилище недоступно (приватный режим и т.п.) — работаем без сохранения */ }
}

/** Восстанавливает прогресс; возвращает true, если сохранённое состояние было. */
function restoreState() {
    let state;
    try {
        state = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
        return false;
    }
    if (!state || state.v !== STORAGE_VERSION) return false;

    shiftDate.value = state.date || todayIso();
    operatorName.value = state.operator || '';
    if (HEAD_OPTIONS.includes(state.heads)) document.querySelector(`input[name="heads"][value="${state.heads}"]`).checked = true;
    runsInput.value = state.runs || 1;
    renderMachineOptions();
    if (state.machine) machineSelect.value = state.machine;

    for (const { machine, items } of state.jobs || []) {
        machineJobs[machine] = items.map(j => ({ item: restoreItem(j.item, j.heads), heads: j.heads, runs: j.runs }));
    }

    if (state.manual) {
        manualMode = true;
        manualBase = state.manual.base && findDbItem(state.manual.base.product, state.manual.base.fileName);
        manualDirty = state.manual.dirty;
        Object.entries(state.manual.fields || {}).forEach(([k, v]) => { if (mFields[k]) mFields[k].value = v; });
    }
    return true;
}

// Поля смены, станок, головы, запуски, правка запусков в таблице, ручной ввод — всё через input/change.
document.addEventListener('input', saveState);
document.addEventListener('change', saveState);
manualBtn.addEventListener('click', saveState);

// --- ДАТА БАЗЫ (report.js пишет parse.js; файла может не быть) ---

function renderBaseInfo() {
    if (typeof REPORT === 'undefined') return;
    const skipped = REPORT.excluded.length;
    $('baseInfo').innerHTML =
        `<span>База от <b>${formatDateTime(new Date(REPORT.generatedAt))}</b></span>` +
        (skipped ? `<span class="topbar-warn">${skipped} ${plural(skipped, 'позиция', 'позиции', 'позиций')} таблицы не ${plural(skipped, 'попала', 'попали', 'попали')} в базу</span>` : '');
}

// --- ИНИЦИАЛИЗАЦИЯ ---

renderBaseInfo();
const restored = restoreState();
if (!restored) shiftDate.value = todayIso();
renderMachineOptions();
renderJobs();
if (restored && sortedMachineIds().length) showToast('Задание восстановлено с прошлого раза');
