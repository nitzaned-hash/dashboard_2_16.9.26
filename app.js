'use strict';

/* =========================================================
   Data layer — localStorage now, swappable for a backend later.
   Everything else in this file talks to DataStore / CategoryStore,
   never to localStorage directly.
   ========================================================= */
const DataStore = (() => {
  const TX_KEY = 'bp_transactions_v1';

  function getAll() {
    try { return JSON.parse(localStorage.getItem(TX_KEY)) || []; }
    catch { return []; }
  }
  function saveAll(list) {
    localStorage.setItem(TX_KEY, JSON.stringify(list));
  }
  function add(tx) {
    const list = getAll();
    tx.id = 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    tx.createdAt = Date.now();
    list.push(tx);
    saveAll(list);
    return tx;
  }
  function update(id, patch) {
    const list = getAll();
    const i = list.findIndex(t => t.id === id);
    if (i === -1) return null;
    list[i] = { ...list[i], ...patch };
    saveAll(list);
    return list[i];
  }
  function remove(id) {
    saveAll(getAll().filter(t => t.id !== id));
  }
  return { getAll, add, update, remove };
})();

const CategoryStore = (() => {
  const CAT_KEY = 'bp_categories_v1';
  const DEFAULTS = [
    { id: 'sales', name: 'Sales', colorVar: '--cat-1' },
    { id: 'services', name: 'Services', colorVar: '--cat-2' },
    { id: 'rent', name: 'Rent', colorVar: '--cat-3' },
    { id: 'supplies', name: 'Supplies', colorVar: '--cat-4' },
    { id: 'payroll', name: 'Payroll', colorVar: '--cat-5' },
    { id: 'utilities', name: 'Utilities', colorVar: '--cat-6' },
    { id: 'marketing', name: 'Marketing', colorVar: '--cat-7' },
    { id: 'other', name: 'Other', colorVar: '--cat-other' },
  ];
  const ROTATION = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7'];

  function getAll() {
    try {
      const custom = JSON.parse(localStorage.getItem(CAT_KEY)) || [];
      return [...DEFAULTS, ...custom];
    } catch { return DEFAULTS.slice(); }
  }
  function add(name) {
    const custom = (() => { try { return JSON.parse(localStorage.getItem(CAT_KEY)) || []; } catch { return []; } })();
    const allExisting = [...DEFAULTS, ...custom];
    const usedVars = new Set(allExisting.map(c => c.colorVar));
    const nextVar = ROTATION.find(v => !usedVars.has(v)) || '--cat-other';
    const id = 'c_' + Date.now().toString(36);
    const cat = { id, name, colorVar: nextVar };
    custom.push(cat);
    localStorage.setItem(CAT_KEY, JSON.stringify(custom));
    return cat;
  }
  function byId(id) {
    return getAll().find(c => c.id === id);
  }
  return { getAll, add, byId };
})();

/* =========================================================
   Airtable sync — optional, off by default.
   The token lives only in this browser's localStorage; it is never
   written into app.js/index.html/the repo. Nothing here runs unless
   the user has saved a token via the Airtable Sync settings panel.
   ========================================================= */
const AirtableSync = (() => {
  const CFG_KEY = 'bp_airtable_config';

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }
    catch { return null; }
  }
  function setConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  function clearConfig() { localStorage.removeItem(CFG_KEY); }
  function isConnected() {
    const c = getConfig();
    return !!(c && c.token && c.baseId && c.tableId);
  }

  function apiUrl(cfg, path) {
    return `https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableId)}${path || ''}`;
  }
  async function request(path, options) {
    const cfg = getConfig();
    if (!cfg || !cfg.token) throw new Error('Airtable is not connected');
    const res = await fetch(apiUrl(cfg, path), {
      ...options,
      headers: {
        'Authorization': `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        ...(options && options.headers),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Airtable ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  // ---- field <-> dashboard value mapping ----
  function typeToAirtable(t) { return t === 'income' ? 'Income' : 'Expense'; }
  function typeFromAirtable(s) { return s === 'Income' ? 'income' : 'expense'; }
  function recurringToAirtable(r) {
    if (!r) return 'None';
    return r[0].toUpperCase() + r.slice(1);
  }
  function recurringFromAirtable(s) {
    if (!s || s === 'None') return '';
    return s.toLowerCase();
  }
  function txToFields(t) {
    const cat = CategoryStore.byId(t.categoryId);
    return {
      Date: t.date,
      Type: typeToAirtable(t.type),
      Category: cat ? cat.name : 'Other',
      Notes: t.notes || '',
      Amount: t.amount,
      Recurring: recurringToAirtable(t.recurring),
    };
  }
  function fieldsToTx(record) {
    const f = record.fields || {};
    const cats = CategoryStore.getAll();
    const cat = cats.find(c => c.name === f.Category) || cats.find(c => c.id === 'other');
    return {
      airtableId: record.id,
      type: typeFromAirtable(f.Type),
      amount: Number(f.Amount) || 0,
      date: f.Date || todayISO(),
      categoryId: cat.id,
      notes: f.Notes || '',
      recurring: recurringFromAirtable(f.Recurring),
    };
  }

  // ---- push: mirror a local change to Airtable (best-effort) ----
  async function pushCreate(tx) {
    const data = await request('', {
      method: 'POST',
      body: JSON.stringify({ typecast: true, records: [{ fields: txToFields(tx) }] }),
    });
    return data.records[0].id;
  }
  async function pushUpdate(airtableId, tx) {
    await request('', {
      method: 'PATCH',
      body: JSON.stringify({ typecast: true, records: [{ id: airtableId, fields: txToFields(tx) }] }),
    });
  }
  async function pushDelete(airtableId) {
    await request(`?records[]=${encodeURIComponent(airtableId)}`, { method: 'DELETE' });
  }

  // ---- pull: fetch every record from the configured table ----
  async function pullAll() {
    let all = [];
    let offset;
    do {
      const qs = offset ? `?offset=${encodeURIComponent(offset)}` : '';
      const data = await request(qs, { method: 'GET' });
      all = all.concat(data.records);
      offset = data.offset;
    } while (offset);
    return all.map(fieldsToTx);
  }

  // ---- sync: push any un-synced local rows, then pull and upsert by airtableId ----
  async function syncNow() {
    const local = DataStore.getAll();
    for (const t of local) {
      if (!t.airtableId) {
        const id = await pushCreate(t);
        DataStore.update(t.id, { airtableId: id });
      }
    }
    const remote = await pullAll();
    const current = DataStore.getAll();
    let added = 0, updated = 0;
    for (const r of remote) {
      const match = current.find(t => t.airtableId === r.airtableId);
      if (match) {
        DataStore.update(match.id, r);
        updated++;
      } else {
        DataStore.add(r);
        added++;
      }
    }
    return { added, updated };
  }

  return {
    getConfig, setConfig, clearConfig, isConnected,
    pushCreate, pushUpdate, pushDelete, syncNow,
  };
})();

/* =========================================================
   Helpers
   ========================================================= */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return sign + '₪' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function uid() { return Math.random().toString(36).slice(2, 9); }

/* =========================================================
   State
   ========================================================= */
const state = {
  range: '30',
  customFrom: null,
  customTo: null,
  categoryFilter: 'all',
  typeFilter: 'all',
  donutType: 'expense',
};

function getRangeDates() {
  const to = startOfDay(new Date());
  let from;
  switch (state.range) {
    case '7': from = addDays(to, -6); break;
    case '30': from = addDays(to, -29); break;
    case '90': from = addDays(to, -89); break;
    case 'month': from = new Date(to.getFullYear(), to.getMonth(), 1); break;
    case 'year': from = new Date(to.getFullYear(), 0, 1); break;
    case 'all': {
      const all = DataStore.getAll();
      if (all.length === 0) { from = addDays(to, -29); break; }
      const min = all.reduce((m, t) => Math.min(m, parseISO(t.date).getTime()), Infinity);
      from = startOfDay(new Date(min));
      break;
    }
    case 'custom':
      from = state.customFrom ? startOfDay(parseISO(state.customFrom)) : addDays(to, -29);
      return { from, to: state.customTo ? startOfDay(parseISO(state.customTo)) : to };
    default: from = addDays(to, -29);
  }
  return { from, to };
}

function getFilteredTransactions() {
  const { from, to } = getRangeDates();
  const toEnd = addDays(to, 1); // inclusive end of day
  return DataStore.getAll().filter(t => {
    const d = parseISO(t.date);
    if (d < from || d >= toEnd) return false;
    if (state.categoryFilter !== 'all' && t.categoryId !== state.categoryFilter) return false;
    if (state.typeFilter !== 'all' && t.type !== state.typeFilter) return false;
    return true;
  });
}

/* =========================================================
   DOM refs
   ========================================================= */
const $ = sel => document.querySelector(sel);
const els = {
  dateRange: $('#dateRange'),
  customRange: $('#customRange'),
  customFrom: $('#customFrom'),
  customTo: $('#customTo'),
  statIncome: $('#statIncome'),
  statExpense: $('#statExpense'),
  statBalance: $('#statBalance'),
  cardBalance: $('#cardBalance'),
  categoryFilter: $('#categoryFilter'),
  typeFilter: $('#typeFilter'),
  btnResetFilters: $('#btnResetFilters'),
  txList: $('#txList'),
  emptyState: $('#emptyState'),
  txTableBody: $('#txTableBody'),
  tableEmptyState: $('#tableEmptyState'),
  trendCanvas: $('#trendChart'),
  trendTooltip: $('#trendTooltip'),
  trendLegend: $('#trendLegend'),
  donutCanvas: $('#donutChart'),
  donutTooltip: $('#donutTooltip'),
  donutLegend: $('#donutLegend'),
  donutCenter: $('#donutCenter'),
  donutToggle: $('#donutToggle'),
  btnAddIncome: $('#btnAddIncome'),
  btnAddExpense: $('#btnAddExpense'),
  modalOverlay: $('#modalOverlay'),
  modalTitle: $('#modalTitle'),
  modalClose: $('#modalClose'),
  typeToggle: $('#typeToggle'),
  txForm: $('#txForm'),
  txId: $('#txId'),
  txAmount: $('#txAmount'),
  txDate: $('#txDate'),
  txCategory: $('#txCategory'),
  txNotes: $('#txNotes'),
  txRecurring: $('#txRecurring'),
  btnDelete: $('#btnDelete'),
  btnCancel: $('#btnCancel'),
  catOverlay: $('#catOverlay'),
  catClose: $('#catClose'),
  catCancel: $('#catCancel'),
  catForm: $('#catForm'),
  catName: $('#catName'),
  toast: $('#toast'),
  btnAirtableSettings: $('#btnAirtableSettings'),
  airtableOverlay: $('#airtableOverlay'),
  airtableClose: $('#airtableClose'),
  airtableStatus: $('#airtableStatus'),
  airtableForm: $('#airtableForm'),
  airtableToken: $('#airtableToken'),
  airtableBaseId: $('#airtableBaseId'),
  airtableTableId: $('#airtableTableId'),
  btnAirtableSync: $('#btnAirtableSync'),
  btnAirtableDisconnect: $('#btnAirtableDisconnect'),
};

let activeTxType = 'income';
let toastTimer = null;

/* =========================================================
   Rendering: summary cards
   ========================================================= */
function renderCards(list) {
  const income = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;
  els.statIncome.textContent = fmtMoney(income);
  els.statExpense.textContent = fmtMoney(expense);
  els.statBalance.textContent = fmtMoney(balance);
  els.cardBalance.classList.toggle('pos', balance >= 0);
  els.cardBalance.classList.toggle('neg', balance < 0);
}

/* =========================================================
   Rendering: transaction list
   ========================================================= */
function renderTxList(list) {
  const sorted = list.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  els.txList.innerHTML = '';
  els.emptyState.classList.toggle('hidden', sorted.length > 0);

  const recentSlice = sorted.slice(0, 40);
  for (const t of recentSlice) {
    const cat = CategoryStore.byId(t.categoryId) || { name: 'Other', colorVar: '--cat-other' };
    const li = document.createElement('li');
    li.className = 'tx-row';
    li.dataset.id = t.id;

    const dot = document.createElement('span');
    dot.className = 'tx-dot';
    dot.style.background = cssVar(cat.colorVar);

    const main = document.createElement('div');
    main.className = 'tx-main';
    const catEl = document.createElement('span');
    catEl.className = 'tx-cat';
    catEl.textContent = cat.name;
    if (t.recurring) {
      const badge = document.createElement('span');
      badge.className = 'tx-badge';
      badge.textContent = '🔁 ' + t.recurring[0].toUpperCase() + t.recurring.slice(1);
      catEl.appendChild(badge);
    }
    const meta = document.createElement('span');
    meta.className = 'tx-meta';
    const dateStr = parseISO(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    meta.textContent = t.notes ? `${dateStr} · ${t.notes}` : dateStr;
    main.append(catEl, meta);

    const amount = document.createElement('div');
    amount.className = 'tx-amount ' + t.type;
    amount.textContent = (t.type === 'income' ? '+' : '−') + fmtMoney(t.amount).replace('-', '');

    li.append(dot, main, amount);
    li.addEventListener('click', () => openEditModal(t));
    els.txList.appendChild(li);
  }
}

/* =========================================================
   Rendering: transaction table
   ========================================================= */
function renderTxTable(list) {
  const sorted = list.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  els.txTableBody.innerHTML = '';
  els.tableEmptyState.classList.toggle('hidden', sorted.length > 0);

  for (const t of sorted) {
    const cat = CategoryStore.byId(t.categoryId) || { name: 'Other', colorVar: '--cat-other' };
    const tr = document.createElement('tr');
    tr.dataset.id = t.id;
    tr.style.cursor = 'pointer';

    const dateStr = parseISO(t.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const tdDate = document.createElement('td');
    tdDate.textContent = dateStr;

    const tdType = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'type-pill ' + t.type;
    pill.textContent = t.type === 'income' ? 'Income' : 'Expense';
    tdType.appendChild(pill);

    const tdCat = document.createElement('td');
    tdCat.className = 'td-cat';
    const dot = document.createElement('span');
    dot.className = 'tx-dot';
    dot.style.background = cssVar(cat.colorVar);
    const catName = document.createElement('span');
    catName.textContent = cat.name;
    tdCat.append(dot, catName);
    if (t.recurring) {
      const badge = document.createElement('span');
      badge.className = 'tx-badge';
      badge.textContent = '🔁 ' + t.recurring[0].toUpperCase() + t.recurring.slice(1);
      tdCat.appendChild(badge);
    }

    const tdNotes = document.createElement('td');
    tdNotes.className = 'td-notes';
    tdNotes.textContent = t.notes || '—';

    const tdAmount = document.createElement('td');
    tdAmount.className = 'td-amount ' + t.type;
    tdAmount.textContent = (t.type === 'income' ? '+' : '−') + fmtMoney(t.amount).replace('-', '');

    tr.append(tdDate, tdType, tdCat, tdNotes, tdAmount);
    tr.addEventListener('click', () => openEditModal(t));
    els.txTableBody.appendChild(tr);
  }
}

/* =========================================================
   Canvas setup helper
   ========================================================= */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.max(1, w * dpr);
  canvas.height = Math.max(1, h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* =========================================================
   Trend chart (grouped bars: income vs expense per bucket)
   ========================================================= */
let trendBuckets = [];

function buildBuckets() {
  const { from, to } = getRangeDates();
  const spanDays = Math.max(1, Math.round((to - from) / 86400000) + 1);
  let mode = 'day';
  if (spanDays > 120) mode = 'month';
  else if (spanDays > 31) mode = 'week';

  const buckets = [];
  if (mode === 'day') {
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), from: startOfDay(d), to: addDays(startOfDay(d), 1) });
    }
  } else if (mode === 'week') {
    let d = new Date(from);
    while (d <= to) {
      const wEnd = addDays(d, 7);
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), from: startOfDay(d), to: wEnd });
      d = wEnd;
    }
  } else {
    let d = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (d <= end) {
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      buckets.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), from: startOfDay(d), to: mEnd });
      d = mEnd;
    }
  }
  return buckets;
}

function renderTrendLegend() {
  els.trendLegend.innerHTML = `
    <span class="legend-item"><span class="swatch" style="background:${cssVar('--income')}"></span>Income</span>
    <span class="legend-item"><span class="swatch" style="background:${cssVar('--expense')}"></span>Expenses</span>
  `;
}

function renderTrendChart(list) {
  const buckets = buildBuckets();
  trendBuckets = buckets.map(b => {
    const inList = list.filter(t => {
      const d = parseISO(t.date);
      return d >= b.from && d < b.to;
    });
    return {
      ...b,
      income: inList.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      expense: inList.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    };
  });

  const { ctx, w, h } = setupCanvas(els.trendCanvas);
  ctx.clearRect(0, 0, w, h);

  const padL = 8, padR = 8, padT = 10, padB = 24;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const max = Math.max(1, ...trendBuckets.map(b => Math.max(b.income, b.expense)));
  const niceMax = max * 1.15;

  const gridColor = cssVar('--gridline');
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padT + plotH * (i / 3);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }

  const n = trendBuckets.length || 1;
  const groupW = plotW / n;
  const barW = Math.max(3, Math.min(22, groupW * 0.32));
  const incomeColor = cssVar('--income');
  const expenseColor = cssVar('--expense');

  function barHeight(v) { return (v / niceMax) * plotH; }
  function drawBar(x, v, color) {
    const bh = barHeight(v);
    const y = padT + plotH - bh;
    const r = Math.min(4, barW / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (bh < r) { ctx.fillRect(x, y, barW, bh); return; }
    ctx.moveTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.arcTo(x + barW, y, x + barW, y + r, r);
    ctx.lineTo(x + barW, y + bh);
    ctx.lineTo(x, y + bh);
    ctx.closePath();
    ctx.fill();
  }

  const labelEvery = Math.ceil(n / (w < 420 ? 5 : 9));
  ctx.fillStyle = cssVar('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';

  trendBuckets.forEach((b, i) => {
    const gx = padL + i * groupW;
    const gap = 2;
    drawBar(gx + groupW / 2 - barW - gap / 2, b.income, incomeColor);
    drawBar(gx + groupW / 2 + gap / 2, b.expense, expenseColor);
    if (i % labelEvery === 0) {
      ctx.fillText(b.label, gx + groupW / 2, h - 6);
    }
  });

  ctx.strokeStyle = cssVar('--baseline');
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH + 0.5);
  ctx.lineTo(w - padR, padT + plotH + 0.5);
  ctx.stroke();

  els.trendCanvas._groupW = groupW;
  els.trendCanvas._padL = padL;
}

function trendPointerHandler(clientX, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const groupW = canvas._groupW || 1;
  const padL = canvas._padL || 0;
  let idx = Math.floor((x - padL) / groupW);
  idx = Math.max(0, Math.min(trendBuckets.length - 1, idx));
  const b = trendBuckets[idx];
  if (!b) return hideTooltip(els.trendTooltip);
  els.trendTooltip.innerHTML = `<strong>${b.label}</strong><br>Income ${fmtMoney(b.income)} · Expenses ${fmtMoney(b.expense)}`;
  showTooltipAt(els.trendTooltip, x, 10, els.trendCanvas.parentElement);
}
function showTooltipAt(tip, x, y, container) {
  tip.classList.remove('hidden');
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTooltip(tip) { tip.classList.add('hidden'); }

/* =========================================================
   Donut chart (category breakdown)
   ========================================================= */
let donutSlices = [];

function renderDonut(list) {
  const filtered = list.filter(t => t.type === state.donutType);
  const byCat = new Map();
  for (const t of filtered) {
    byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
  }
  const total = [...byCat.values()].reduce((s, v) => s + v, 0);
  const cats = CategoryStore.getAll();
  let entries = [...byCat.entries()]
    .map(([id, value]) => {
      const cat = cats.find(c => c.id === id) || { name: 'Other', colorVar: '--cat-other' };
      return { id, name: cat.name, color: cssVar(cat.colorVar), value, pct: total ? value / total : 0 };
    })
    .sort((a, b) => b.value - a.value);

  donutSlices = entries;

  const { ctx, w, h } = setupCanvas(els.donutCanvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const outerR = Math.min(w, h) / 2 - 2;
  const innerR = outerR * 0.62;
  const gap = 0.025; // radians gap between slices

  els.donutCenter.innerHTML = total
    ? `<div class="dc-total">${fmtMoney(total)}</div><div class="dc-label">${state.donutType === 'expense' ? 'Total Expenses' : 'Total Income'}</div>`
    : `<div class="dc-label">No ${state.donutType} data</div>`;

  if (!entries.length) {
    ctx.beginPath();
    ctx.arc(cx, cy, (outerR + innerR) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = cssVar('--gridline');
    ctx.lineWidth = outerR - innerR;
    ctx.stroke();
    renderDonutLegend([]);
    return;
  }

  let angle = -Math.PI / 2;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  entries.forEach(e => {
    const sweep = e.pct * Math.PI * 2;
    const a0 = angle + gap / 2;
    const a1 = angle + sweep - gap / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, (outerR + innerR) / 2, a0, Math.max(a0, a1));
    ctx.lineWidth = outerR - innerR;
    ctx.strokeStyle = e.color;
    ctx.lineCap = 'butt';
    ctx.stroke();

    if (e.pct >= 0.08) {
      const mid = (a0 + a1) / 2;
      const lr = (outerR + innerR) / 2;
      const lx = cx + Math.cos(mid) * lr;
      const ly = cy + Math.sin(mid) * lr;
      ctx.fillStyle = '#fff';
      ctx.fillText(Math.round(e.pct * 100) + '%', lx, ly);
    }
    e._a0 = angle; e._a1 = angle + sweep;
    angle += sweep;
  });

  renderDonutLegend(entries);
}

function renderDonutLegend(entries) {
  els.donutLegend.innerHTML = '';
  if (!entries.length) {
    els.donutLegend.innerHTML = `<li class="lg-name" style="color:var(--text-muted)">No transactions in this range.</li>`;
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${e.color}"></span><span class="lg-name">${e.name}</span><span class="lg-pct">${Math.round(e.pct * 100)}%</span>`;
    els.donutLegend.appendChild(li);
  }
}

function donutPointerHandler(clientX, clientY, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const cx = rect.width / 2, cy = rect.height / 2;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const outerR = Math.min(rect.width, rect.height) / 2 - 2;
  const innerR = outerR * 0.62;
  if (dist < innerR - 4 || dist > outerR + 4) return hideTooltip(els.donutTooltip);
  let a = Math.atan2(dy, dx);
  const base = -Math.PI / 2;
  let rel = a - base;
  while (rel < 0) rel += Math.PI * 2;
  while (rel > Math.PI * 2) rel -= Math.PI * 2;
  const target = base + rel;
  const slice = donutSlices.find(s => {
    let a0 = s._a0, a1 = s._a1;
    return target >= a0 && target <= a1;
  });
  if (!slice) return hideTooltip(els.donutTooltip);
  els.donutTooltip.innerHTML = `<strong>${slice.name}</strong><br>${fmtMoney(slice.value)} · ${Math.round(slice.pct * 100)}%`;
  showTooltipAt(els.donutTooltip, x, y - 8, null);
}

/* =========================================================
   Filters UI
   ========================================================= */
function populateCategorySelect() {
  const cats = CategoryStore.getAll();
  els.categoryFilter.innerHTML = '<option value="all">All categories</option>' +
    cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  els.categoryFilter.value = state.categoryFilter;
}

function populateTxCategorySelect(selectedId) {
  const cats = CategoryStore.getAll();
  els.txCategory.innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('') +
    `<option value="__add__">+ Add new category…</option>`;
  if (selectedId) els.txCategory.value = selectedId;
}

/* =========================================================
   Master render
   ========================================================= */
function renderAll() {
  const list = getFilteredTransactions();
  renderCards(list);
  renderTrendLegend();
  renderTrendChart(list);
  renderDonut(list);
  renderTxList(list);
  renderTxTable(list);
}

/* =========================================================
   Modal: add / edit transaction
   ========================================================= */
function setActiveType(type) {
  activeTxType = type;
  els.typeToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}

function openAddModal(type) {
  setActiveType(type);
  els.modalTitle.textContent = type === 'income' ? 'Add Income' : 'Add Expense';
  els.txId.value = '';
  els.txAmount.value = '';
  els.txDate.value = todayISO();
  populateTxCategorySelect();
  els.txNotes.value = '';
  els.txRecurring.value = '';
  els.btnDelete.classList.add('hidden');
  els.modalOverlay.classList.remove('hidden');
  setTimeout(() => els.txAmount.focus(), 50);
}

function openEditModal(tx) {
  setActiveType(tx.type);
  els.modalTitle.textContent = tx.type === 'income' ? 'Edit Income' : 'Edit Expense';
  els.txId.value = tx.id;
  els.txAmount.value = tx.amount;
  els.txDate.value = tx.date;
  populateTxCategorySelect(tx.categoryId);
  els.txNotes.value = tx.notes || '';
  els.txRecurring.value = tx.recurring || '';
  els.btnDelete.classList.remove('hidden');
  els.modalOverlay.classList.remove('hidden');
}

function closeModal() { els.modalOverlay.classList.add('hidden'); }

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
}

/* =========================================================
   Wire up events
   ========================================================= */
els.dateRange.addEventListener('change', () => {
  state.range = els.dateRange.value;
  els.customRange.classList.toggle('hidden', state.range !== 'custom');
  if (state.range === 'custom' && !els.customFrom.value) {
    els.customFrom.value = addDays(new Date(), -29).toISOString().slice(0, 10);
    els.customTo.value = todayISO();
    state.customFrom = els.customFrom.value;
    state.customTo = els.customTo.value;
  }
  renderAll();
});
els.customFrom.addEventListener('change', () => { state.customFrom = els.customFrom.value; renderAll(); });
els.customTo.addEventListener('change', () => { state.customTo = els.customTo.value; renderAll(); });

els.categoryFilter.addEventListener('change', () => { state.categoryFilter = els.categoryFilter.value; renderAll(); });
els.typeFilter.addEventListener('change', () => { state.typeFilter = els.typeFilter.value; renderAll(); });
els.btnResetFilters.addEventListener('click', () => {
  state.categoryFilter = 'all'; state.typeFilter = 'all';
  els.categoryFilter.value = 'all'; els.typeFilter.value = 'all';
  renderAll();
});

document.getElementById('donutToggle').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  state.donutType = btn.dataset.type;
  document.querySelectorAll('#donutToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  renderAll();
});

els.btnAddIncome.addEventListener('click', () => openAddModal('income'));
els.btnAddExpense.addEventListener('click', () => openAddModal('expense'));
els.modalClose.addEventListener('click', closeModal);
els.btnCancel.addEventListener('click', closeModal);
els.modalOverlay.addEventListener('click', e => { if (e.target === els.modalOverlay) closeModal(); });

els.typeToggle.addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  setActiveType(btn.dataset.type);
  els.modalTitle.textContent = (activeTxType === 'income' ? (els.txId.value ? 'Edit Income' : 'Add Income') : (els.txId.value ? 'Edit Expense' : 'Add Expense'));
});

els.txCategory.addEventListener('change', () => {
  if (els.txCategory.value === '__add__') {
    els.catName.value = '';
    els.catOverlay.classList.remove('hidden');
    setTimeout(() => els.catName.focus(), 50);
  }
});
els.catClose.addEventListener('click', () => { els.catOverlay.classList.add('hidden'); populateTxCategorySelect(); });
els.catCancel.addEventListener('click', () => { els.catOverlay.classList.add('hidden'); populateTxCategorySelect(); });
els.catOverlay.addEventListener('click', e => { if (e.target === els.catOverlay) { els.catOverlay.classList.add('hidden'); populateTxCategorySelect(); } });
els.catForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = els.catName.value.trim();
  if (!name) return;
  const cat = CategoryStore.add(name);
  els.catOverlay.classList.add('hidden');
  populateTxCategorySelect(cat.id);
  populateCategorySelect();
});

/* =========================================================
   Airtable sync settings modal
   ========================================================= */
function refreshAirtableStatus() {
  const connected = AirtableSync.isConnected();
  els.airtableStatus.textContent = connected
    ? 'Connected — changes you make here will sync to Airtable.'
    : 'Not connected.';
  els.airtableStatus.classList.toggle('connected', connected);
  els.btnAirtableSync.classList.toggle('hidden', !connected);
  els.btnAirtableDisconnect.classList.toggle('hidden', !connected);
}

// Pre-fills the base/table created for this project; the token is never
// prefilled or stored anywhere but the user's own browser.
const AIRTABLE_DEFAULT_BASE = 'appYFa7UObm82c5t9';
const AIRTABLE_DEFAULT_TABLE = 'tblxeZl6jQP11A6xM';

function openAirtableModal() {
  const cfg = AirtableSync.getConfig();
  els.airtableToken.value = '';
  els.airtableBaseId.value = (cfg && cfg.baseId) || AIRTABLE_DEFAULT_BASE;
  els.airtableTableId.value = (cfg && cfg.tableId) || AIRTABLE_DEFAULT_TABLE;
  refreshAirtableStatus();
  els.airtableOverlay.classList.remove('hidden');
}
function closeAirtableModal() { els.airtableOverlay.classList.add('hidden'); }

els.btnAirtableSettings.addEventListener('click', openAirtableModal);
els.airtableClose.addEventListener('click', closeAirtableModal);
els.airtableOverlay.addEventListener('click', e => { if (e.target === els.airtableOverlay) closeAirtableModal(); });

els.airtableForm.addEventListener('submit', e => {
  e.preventDefault();
  const baseId = els.airtableBaseId.value.trim();
  const tableId = els.airtableTableId.value.trim();
  const tokenInput = els.airtableToken.value.trim();
  const existing = AirtableSync.getConfig();
  const token = tokenInput || (existing && existing.token) || '';
  if (!token || !baseId || !tableId) {
    showToast('Token, Base ID, and Table are all required');
    return;
  }
  AirtableSync.setConfig({ token, baseId, tableId });
  refreshAirtableStatus();
  showToast('Airtable connected');
});

els.btnAirtableDisconnect.addEventListener('click', () => {
  AirtableSync.clearConfig();
  els.airtableToken.value = '';
  refreshAirtableStatus();
  showToast('Airtable disconnected');
});

els.btnAirtableSync.addEventListener('click', async () => {
  els.btnAirtableSync.disabled = true;
  els.btnAirtableSync.textContent = 'Syncing…';
  try {
    const { added, updated } = await AirtableSync.syncNow();
    showToast(`Synced — ${added} added, ${updated} updated`);
    populateCategorySelect();
    renderAll();
  } catch (err) {
    showToast('Sync failed: ' + err.message);
  } finally {
    els.btnAirtableSync.disabled = false;
    els.btnAirtableSync.textContent = 'Sync now';
  }
});

els.txForm.addEventListener('submit', e => {
  e.preventDefault();
  const amount = parseFloat(els.txAmount.value);
  if (!(amount > 0)) { showToast('Enter an amount greater than 0'); return; }
  if (els.txCategory.value === '__add__') { showToast('Pick or add a category'); return; }
  const payload = {
    type: activeTxType,
    amount,
    date: els.txDate.value || todayISO(),
    categoryId: els.txCategory.value,
    notes: els.txNotes.value.trim(),
    recurring: els.txRecurring.value || '',
  };
  if (els.txId.value) {
    const existing = DataStore.getAll().find(t => t.id === els.txId.value);
    const updated = DataStore.update(els.txId.value, payload);
    showToast('Transaction updated');
    if (existing && existing.airtableId) {
      AirtableSync.pushUpdate(existing.airtableId, updated).catch(() => showToast('Saved locally — Airtable sync failed'));
    }
  } else {
    const created = DataStore.add(payload);
    showToast(activeTxType === 'income' ? 'Income added' : 'Expense added');
    if (AirtableSync.isConnected()) {
      AirtableSync.pushCreate(created)
        .then(airtableId => DataStore.update(created.id, { airtableId }))
        .catch(() => showToast('Saved locally — Airtable sync failed'));
    }
  }
  closeModal();
  populateCategorySelect();
  renderAll();
});

els.btnDelete.addEventListener('click', () => {
  if (!els.txId.value) return;
  if (confirm('Delete this transaction? This cannot be undone.')) {
    const existing = DataStore.getAll().find(t => t.id === els.txId.value);
    DataStore.remove(els.txId.value);
    closeModal();
    renderAll();
    showToast('Transaction deleted');
    if (existing && existing.airtableId) {
      AirtableSync.pushDelete(existing.airtableId).catch(() => showToast('Deleted locally — Airtable sync failed'));
    }
  }
});

// Trend chart pointer interactions
els.trendCanvas.addEventListener('mousemove', e => trendPointerHandler(e.clientX, els.trendCanvas));
els.trendCanvas.addEventListener('mouseleave', () => hideTooltip(els.trendTooltip));
els.trendCanvas.addEventListener('touchstart', e => { trendPointerHandler(e.touches[0].clientX, els.trendCanvas); }, { passive: true });
els.trendCanvas.addEventListener('touchmove', e => { trendPointerHandler(e.touches[0].clientX, els.trendCanvas); }, { passive: true });
els.trendCanvas.addEventListener('touchend', () => setTimeout(() => hideTooltip(els.trendTooltip), 1200));

// Donut chart pointer interactions
els.donutCanvas.addEventListener('mousemove', e => donutPointerHandler(e.clientX, e.clientY, els.donutCanvas));
els.donutCanvas.addEventListener('mouseleave', () => hideTooltip(els.donutTooltip));
els.donutCanvas.addEventListener('touchstart', e => { const t = e.touches[0]; donutPointerHandler(t.clientX, t.clientY, els.donutCanvas); }, { passive: true });
els.donutCanvas.addEventListener('touchend', () => setTimeout(() => hideTooltip(els.donutTooltip), 1200));

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 120);
});

/* =========================================================
   Seed a little sample data on first run so the dashboard
   isn't empty on first open.
   ========================================================= */
function maybeSeed() {
  if (DataStore.getAll().length > 0) return;
  if (localStorage.getItem('bp_seeded_v2')) return;
  const cats = CategoryStore.getAll();
  const find = id => cats.find(c => c.id === id).id;
  const today = new Date();
  const sample = [
    // Income
    { type: 'income', amount: 4200, daysAgo: 1, categoryId: find('sales'), notes: 'Invoice #204', recurring: '' },
    { type: 'income', amount: 1500, daysAgo: 6, categoryId: find('services'), notes: 'Consulting session', recurring: '' },
    { type: 'income', amount: 2600, daysAgo: 18, categoryId: find('sales'), notes: 'Pop-up market', recurring: '' },
    { type: 'income', amount: 3100, daysAgo: 25, categoryId: find('sales'), notes: 'Online store orders', recurring: '' },
    { type: 'income', amount: 1900, daysAgo: 34, categoryId: find('services'), notes: 'Workshop fee', recurring: '' },
    { type: 'income', amount: 5400, daysAgo: 46, categoryId: find('sales'), notes: 'Wholesale order', recurring: '' },
    { type: 'income', amount: 1500, daysAgo: 58, categoryId: find('services'), notes: 'Consulting retainer', recurring: 'monthly' },
    { type: 'income', amount: 3300, daysAgo: 70, categoryId: find('sales'), notes: 'Holiday pop-up', recurring: '' },
    { type: 'income', amount: 2200, daysAgo: 88, categoryId: find('sales'), notes: 'Spring sale', recurring: '' },

    // Expenses
    { type: 'expense', amount: 3200, daysAgo: 2, categoryId: find('rent'), notes: 'Studio rent', recurring: 'monthly' },
    { type: 'expense', amount: 149, daysAgo: 7, categoryId: find('other'), notes: 'Software subscription', recurring: 'monthly' },
    { type: 'expense', amount: 420, daysAgo: 4, categoryId: find('supplies'), notes: 'Packaging materials', recurring: '' },
    { type: 'expense', amount: 1800, daysAgo: 9, categoryId: find('payroll'), notes: 'Part-time assistant', recurring: 'monthly' },
    { type: 'expense', amount: 260, daysAgo: 12, categoryId: find('utilities'), notes: 'Electricity', recurring: 'monthly' },
    { type: 'expense', amount: 350, daysAgo: 15, categoryId: find('marketing'), notes: 'Social ads', recurring: '' },
    { type: 'expense', amount: 680, daysAgo: 20, categoryId: find('supplies'), notes: 'Raw materials', recurring: '' },
    { type: 'expense', amount: 210, daysAgo: 27, categoryId: find('marketing'), notes: 'Flyers printing', recurring: '' },
    { type: 'expense', amount: 3200, daysAgo: 32, categoryId: find('rent'), notes: 'Studio rent', recurring: 'monthly' },
    { type: 'expense', amount: 1800, daysAgo: 39, categoryId: find('payroll'), notes: 'Part-time assistant', recurring: 'monthly' },
    { type: 'expense', amount: 245, daysAgo: 42, categoryId: find('utilities'), notes: 'Electricity', recurring: 'monthly' },
    { type: 'expense', amount: 300, daysAgo: 50, categoryId: find('marketing'), notes: 'Local ads', recurring: '' },
    { type: 'expense', amount: 390, daysAgo: 55, categoryId: find('supplies'), notes: 'Packaging restock', recurring: '' },
    { type: 'expense', amount: 3200, daysAgo: 62, categoryId: find('rent'), notes: 'Studio rent', recurring: 'monthly' },
    { type: 'expense', amount: 1800, daysAgo: 69, categoryId: find('payroll'), notes: 'Part-time assistant', recurring: 'monthly' },
    { type: 'expense', amount: 900, daysAgo: 75, categoryId: find('marketing'), notes: 'Trade show booth', recurring: '' },
  ];
  for (const s of sample) {
    const d = addDays(today, -s.daysAgo);
    DataStore.add({ type: s.type, amount: s.amount, date: d.toISOString().slice(0, 10), categoryId: s.categoryId, notes: s.notes, recurring: s.recurring });
  }
  localStorage.setItem('bp_seeded_v2', '1');
}

/* =========================================================
   Init
   ========================================================= */
function init() {
  maybeSeed();
  populateCategorySelect();
  renderAll();
}
init();
