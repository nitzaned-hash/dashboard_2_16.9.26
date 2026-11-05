/* =========================================================
   Exchange rates — external public API (Frankfurter, ECB reference rates).
   Free, no API key / token, CORS-enabled, so it is safe to call straight
   from this static page (nothing secret is ever stored in the repo).
     GET https://api.frankfurter.dev/v2/rates?base=ILS&quotes=USD,EUR,GBP
     GET https://api.frankfurter.dev/v2/rates?from=..&to=..&base=USD&quotes=ILS
   Shows: today's ILS rates, a 30-day USD/ILS trend, and the dashboard's
   net balance converted to USD / EUR / GBP.
   Rendered with textContent / SVG DOM calls only (never innerHTML).
   ========================================================= */
(() => {
  const API = 'https://api.frankfurter.dev/v2/rates';
  const CURRENCIES = [
    { code: 'USD', symbol: '$' },
    { code: 'EUR', symbol: '€' },
    { code: 'GBP', symbol: '£' },
  ];

  const $r = id => document.getElementById(id);
  const ui = {
    status: $r('fxStatus'),
    list: $r('fxList'),
    trend: $r('fxTrend'),
    trendNote: $r('fxTrendNote'),
    converted: $r('fxConverted'),
    refresh: $r('btnFxRefresh'),
  };
  if (!ui.list) return;

  let ilsTo = null;      // { USD: 0.316, EUR: ..., GBP: ... }  (1 ILS in that currency)
  let asOf = '';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Rates API ${res.status}`);
    return res.json();
  }

  const isoDay = d => d.toISOString().slice(0, 10);

  async function fetchLatest() {
    const quotes = CURRENCIES.map(c => c.code).join(',');
    const rows = await getJson(`${API}?base=ILS&quotes=${quotes}`);
    const map = {};
    let date = '';
    for (const r of rows) {
      if (r && typeof r.rate === 'number' && r.rate > 0) { map[r.quote] = r.rate; date = r.date || date; }
    }
    return { map, date };
  }

  async function fetchTrend() {
    const to = new Date();
    const from = new Date(Date.now() - 30 * 86400000);
    const rows = await getJson(`${API}?from=${isoDay(from)}&to=${isoDay(to)}&base=USD&quotes=ILS`);
    return rows.filter(r => r && typeof r.rate === 'number')
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ---------- rendering ---------- */
  function renderRates() {
    ui.list.replaceChildren(...CURRENCIES.filter(c => ilsTo[c.code]).map(c => h('div', { class: 'fx-row' },
      h('span', { class: 'fx-code', text: c.code }),
      h('span', { class: 'fx-val', text: `₪${(1 / ilsTo[c.code]).toFixed(3)}` }),
    )));
  }

  function renderConverted() {
    const bal = window.BP && typeof window.BP.balance === 'number' ? window.BP.balance : null;
    if (bal == null || !ilsTo) { ui.converted.textContent = ''; return; }
    const parts = CURRENCIES.filter(c => ilsTo[c.code]).map(c => {
      const v = bal * ilsTo[c.code];
      return `${v < 0 ? '−' : ''}${c.symbol}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    });
    ui.converted.textContent = `Net balance in foreign currency: ${parts.join(' · ')}`;
  }

  function renderTrend(series) {
    ui.trend.replaceChildren();
    if (series.length < 2) { ui.trendNote.textContent = 'Not enough history to chart.'; return; }
    const W = 300, H = 90, P = 6;
    const vals = series.map(s => s.rate);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const pts = series.map((s, i) => {
      const x = P + (i / (series.length - 1)) * (W - 2 * P);
      const y = H - P - ((s.rate - min) / span) * (H - 2 * P);
      return [x, y];
    });
    const NS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '));
    line.setAttribute('class', 'fx-line');
    const last = pts[pts.length - 1];
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', last[0].toFixed(1));
    dot.setAttribute('cy', last[1].toFixed(1));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'fx-dot');
    ui.trend.append(line, dot);
    const first = series[0], end = series[series.length - 1];
    const change = ((end.rate - first.rate) / first.rate) * 100;
    ui.trendNote.textContent =
      `USD → ILS, last 30 days: ₪${first.rate.toFixed(3)} → ₪${end.rate.toFixed(3)} ` +
      `(${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}%) · low ₪${min.toFixed(3)} · high ₪${max.toFixed(3)}`;
  }

  /* ---------- load ---------- */
  async function load() {
    ui.status.className = 'source-badge';
    ui.status.textContent = 'Loading…';
    try {
      const [latest, series] = await Promise.all([fetchLatest(), fetchTrend()]);
      ilsTo = latest.map;
      asOf = latest.date;
      renderRates();
      renderTrend(series);
      renderConverted();
      ui.status.className = 'source-badge live';
      ui.status.textContent = asOf ? `Live · ${asOf}` : 'Live';
    } catch (err) {
      console.warn(err);
      ilsTo = null;
      ui.list.replaceChildren(h('p', { class: 'empty-state', text: 'Exchange rates are unavailable right now.' }));
      ui.trend.replaceChildren();
      ui.trendNote.textContent = '';
      ui.converted.textContent = '';
      ui.status.className = 'source-badge';
      ui.status.textContent = 'Offline';
    }
  }

  // The dashboard tells us whenever the net balance (for the selected period) changes.
  document.addEventListener('bp:balance', renderConverted);
  ui.refresh.addEventListener('click', load);
  load();
})();
