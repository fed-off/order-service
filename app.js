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

/** Секунды -> «n часов x минут» (округление до минуты). */
function formatDuration(sec) {
    const totalMin = Math.round(sec / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h} ${plural(h, 'час', 'часа', 'часов')} ${m} ${plural(m, 'минута', 'минуты', 'минут')}`;
}

function formatDistance(cm) {
    return `${cm.toLocaleString('ru-RU')} см`;
}

function formatDate(iso) {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
}

function todayIso() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    searchInput.value = `${item.fileName} — ${item.product}`;
    searchClear.hidden = false;
    closeResults();
    updatePreview();
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
    updatePreview();
    if (!searchResults.hidden) renderSearchResults();
    markCurrentMachine();
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

function updatePreview() {
    const machineId = currentMachine();
    const heads = currentHeads();
    const runs = parseRuns(runsInput.value);
    const loadNow = machineTimeSec(machineId);
    const loadPrefix = `Станок № ${machineId}: `;

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
    setOutput('pvLoad',
        `${escapeHtml(loadPrefix)}${formatDuration(loadNow)}<span class="arrow">→</span><span class="after">${formatDuration(loadNow + total)}</span>`,
        true);
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

// --- ЗАДАНИЕ ПО СТАНКАМ ---

function findJob(machineId, item, heads) {
    return (machineJobs[machineId] || []).find(j => j.item.key === item.key && j.heads === heads);
}

function addJobToMachine() {
    if (!selectedItem) {
        searchInput.focus();
        return;
    }
    const machineId = currentMachine();
    const heads = currentHeads();
    const runs = parseRuns(runsInput.value);
    if (!headData(selectedItem, heads) || !runs) {
        updatePreview();
        return;
    }

    const existing = findJob(machineId, selectedItem, heads);
    let job;
    if (existing) {
        const before = existing.runs;
        existing.runs += runs;
        job = existing;
        showToast(`Станок № ${machineId}: <b>${escapeHtml(job.item.fileName)}</b> — запуски суммированы (${before} → ${job.runs})`);
    } else {
        job = { item: selectedItem, heads, runs };
        (machineJobs[machineId] = machineJobs[machineId] || []).push(job);
        showToast(`Добавлено на станок № ${machineId}: <b>${escapeHtml(job.item.fileName)}</b> × ${runs}`);
    }

    // Станок и кол-во голов сохраняем — обычно на один станок назначают несколько файлов подряд.
    runsInput.value = 1;
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
                        <td><div class="file-cell">${fileCellHtml(escapeHtml(job.item.fileName), escapeHtml(job.item.fileDescription))}</div></td>
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

function generatePDF() {
    const ids = sortedMachineIds();
    if (!ids.length) {
        alert('Нет данных для печати! Сначала добавьте хотя бы одно задание.');
        return;
    }

    const operator = operatorName.value.trim() || 'Не указан';
    const date = formatDate(shiftDate.value);
    $('pdfOperator').textContent = operator;
    $('pdfDate').textContent = date;

    $('pdfMachinesContent').innerHTML = ids.map(mId => {
        const rows = machineJobs[mId].map(job => `
            <tr>
                <td style="text-align: left;">${escapeHtml(job.item.product)}</td>
                <td><div class="file-cell">${fileCellHtml(escapeHtml(job.item.fileName), escapeHtml(job.item.fileDescription))}</div></td>
                <td>${formatDistance(headData(job.item, job.heads).distanceCm)}</td>
                <td><strong>${job.runs}</strong></td>
                <td class="pdf-manual-cell"></td>
                <td class="pdf-manual-cell"></td>
            </tr>`).join('');
        return `
            <div class="pdf-machine">
                <table class="pdf-table">
                    <thead>
                        <!-- Плашка станка внутри thead — повторяется при переносе таблицы на новую страницу -->
                        <tr>
                            <th colspan="6" class="pdf-machine-bar">
                                <span>СТАНОК № ${mId}</span>
                                <span>ОБЩЕЕ ВРЕМЯ ЗАНЯТОСТИ СТАНКА: ${formatDuration(machineTimeSec(mId))}</span>
                            </th>
                        </tr>
                        <tr>
                            <th style="width: 25%;">Описание изделия</th>
                            <th style="width: 20%;">Имя файла</th>
                            <th style="width: 15%;">Расстояние между головами</th>
                            <th style="width: 10%;">Кол-во запусков</th>
                            <th class="pdf-manual-cell">Запусков на начало смены (заполняет оператор)</th>
                            <th class="pdf-manual-cell">Запусков на конец смены (заполняет оператор)</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }).join('');

    // Заголовок документа = имя PDF-файла по умолчанию при «Сохранить как PDF».
    const prevTitle = document.title;
    document.title = `Сменное задание ${date}${operator !== 'Не указан' ? ' ' + operator : ''}`;
    window.addEventListener('afterprint', () => { document.title = prevTitle; }, { once: true });

    window.print();
}

printBtn.addEventListener('click', generatePDF);

// Страница не хранит состояние — предупреждаем о потере задания при закрытии/перезагрузке.
window.addEventListener('beforeunload', e => {
    if (sortedMachineIds().length) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// --- ИНИЦИАЛИЗАЦИЯ ---

shiftDate.value = todayIso();
renderMachineOptions();
renderJobs();
