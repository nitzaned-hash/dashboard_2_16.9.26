/* =========================================================
   Competitor Watch — second screen, data from Apify.
   Expects the output of an Apify Google Maps scraper (one item per place:
   title, totalScore, reviewsCount, categoryName, address, website, url,
   reviews[]). Two sources:
     1. Live: the user's own Apify token + dataset ID, stored only in this
        browser's localStorage (never in code or repo).
     2. Snapshot: data/competitors.json exported from Apify and committed.
   All external text is rendered with textContent (never innerHTML).
   ========================================================= */
const ApifyData = (() => {
  const CFG_KEY = 'bp_apify_config';
  const SNAPSHOT_URL = 'data/competitors.json';

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }
    catch { return null; }
  }
  function setConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  function clearConfig() { localStorage.removeItem(CFG_KEY); }
  function isConnected() {
    const c = getConfig();
    return !!(c && c.token && c.datasetId);
  }

  async function fetchLive() {
    const cfg = getConfig();
    const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(cfg.datasetId)}/items?format=json&clean=true&limit=1000`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apify ${res.status}: ${body.slice(0, 160)}`);
    }
    return res.json();
  }

  async function fetchSnapshot() {
    try {
      const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizePlace(it) {
    if (!it || typeof it !== 'object') return null;
    const name = it.title || it.name || it.placeName;
    if (!name) return null;
    const reviews = Array.isArray(it.reviews) ? it.reviews : [];
    return {
      name: String(name),
      category: String(it.categoryName || (Array.isArray(it.categories) && it.categories[0]) || ''),
      categories: (Array.isArray(it.categories) ? it.categories : [it.categoryName]).filter(Boolean).map(String),
      rating: num(it.totalScore ?? it.rating),
      reviewsCount: num(it.reviewsCount ?? it.userRatingsTotal) || 0,
      city: String(it.city || ''),
      address: String(it.address || ''),
      website: String(it.website || ''),
      url: String(it.url || ''),
      reviews: reviews
        .map(r => ({
          stars: num(r.stars ?? r.rating),
          text: String(r.text || r.textTranslated || ''),
          date: String(r.publishedAtDate || r.publishAt || ''),
        }))
        .filter(r => r.text && r.stars != null),
    };
  }

  function normalize(items) {
    if (!Array.isArray(items)) return [];
    return items.map(normalizePlace).filter(Boolean);
  }

  return { getConfig, setConfig, clearConfig, isConnected, fetchLive, fetchSnapshot, normalize };
})();

(() => {
  const $c = id => document.getElementById(id);
  const ui = {
    tabs: document.querySelectorAll('.tab'),
    viewOverview: $c('viewOverview'),
    viewCompetitors: $c('viewCompetitors'),
    source: $c('compSource'),
    empty: $c('compEmpty'),
    content: $c('compContent'),
    count: $c('compCount'),
    avg: $c('compAvg'),
    reviews: $c('compReviews'),
    top: $c('compTop'),
    ratings: $c('compRatings'),
    cities: $c('compCities'),
    topCat: $c('compTopCat'),
    withSite: $c('compWithSite'),
    cardAvg: $c('cardAvg'),
    cardReviews: $c('cardReviews'),
    cardTop: $c('cardTop'),
    ratingsPanel: $c('compRatingsPanel'),
    reviewsPanel: $c('compReviewsPanel'),
    catBars: $c('compCatBars'),
    cityBars: $c('compCityBars'),
    colRating: document.querySelectorAll('.col-rating'),
    reviewList: $c('compReviewList'),
    reviewToggle: $c('compReviewToggle'),
    tableBody: $c('compTableBody'),
    btnRefresh: $c('btnCompRefresh'),
    btnSettings: $c('btnApifySettings'),
    overlay: $c('apifyOverlay'),
    status: $c('apifyStatus'),
    form: $c('apifyForm'),
    token: $c('apifyToken'),
    datasetId: $c('apifyDatasetId'),
    btnDisconnect: $c('btnApifyDisconnect'),
    close: $c('apifyClose'),
  };

  let places = [];
  let reviewMode = 'complaints';
  let loadedOnce = false;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  }

  function safeUrl(u) {
    try {
      const parsed = new URL(u);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : '';
    } catch { return ''; }
  }

  function stars(n) {
    const full = Math.max(0, Math.min(5, Math.round(n)));
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  function fmtDate(s) {
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- rendering ---------- */
  function setSource(kind, label) {
    ui.source.className = 'source-badge' + (kind ? ' ' + kind : '');
    ui.source.textContent = label;
  }

  function showEmpty(message) {
    ui.content.classList.add('hidden');
    ui.empty.textContent = message;
    ui.empty.classList.remove('hidden');
  }

  function tally(values) {
    const m = new Map();
    values.filter(Boolean).forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function renderBars(container, entries) {
    const max = entries.length ? entries[0][1] : 1;
    container.replaceChildren(...entries.map(([label, n], i) => h('div', { class: 'rating-row' },
      h('div', { class: 'rating-name', title: label, text: label }),
      h('div', { class: 'rating-track' },
        h('div', { class: 'rating-fill' + (i === 0 ? ' top' : ''), style: `width:${(n / max) * 100}%` })),
      h('div', { class: 'rating-val', text: n === 1 ? '1 business' : `${n} businesses` }))));
  }

  function renderMarketMap() {
    const cats = tally(places.flatMap(p => p.categories));
    const cities = tally(places.map(p => p.city));
    ui.cities.textContent = cities.length.toLocaleString('en-US');
    ui.topCat.textContent = cats.length ? cats[0][0] : '–';
    ui.withSite.textContent = `${places.filter(p => safeUrl(p.website)).length} of ${places.length}`;
    renderBars(ui.catBars, cats.slice(0, 8));
    renderBars(ui.cityBars, cities.slice(0, 8));
  }

  function renderSummary() {
    const rated = places.filter(p => p.rating != null);
    const avg = rated.length ? rated.reduce((s, p) => s + p.rating, 0) / rated.length : null;
    const top = rated.slice().sort((a, b) => b.rating - a.rating || b.reviewsCount - a.reviewsCount)[0];
    ui.count.textContent = places.length.toLocaleString('en-US');
    ui.avg.textContent = avg != null ? avg.toFixed(2) + ' ★' : '–';
    ui.reviews.textContent = places.reduce((s, p) => s + p.reviewsCount, 0).toLocaleString('en-US');
    ui.top.textContent = top ? `${top.name} (${top.rating.toFixed(1)} ★)` : '–';
  }

  function renderRatings() {
    const rated = places.filter(p => p.rating != null)
      .sort((a, b) => b.rating - a.rating || b.reviewsCount - a.reviewsCount);
    ui.ratings.replaceChildren(...rated.map((p, i) => h('div', { class: 'rating-row' },
      h('div', { class: 'rating-name', title: p.name, text: p.name }),
      h('div', { class: 'rating-track' },
        h('div', { class: 'rating-fill' + (i === 0 ? ' top' : ''), style: `width:${(p.rating / 5) * 100}%` })),
      h('div', { class: 'rating-val' },
        p.rating.toFixed(1) + ' ★ ',
        h('small', { text: `· ${p.reviewsCount.toLocaleString('en-US')} reviews` })),
    )));
  }

  function renderReviews() {
    const all = places.flatMap(p => p.reviews.map(r => ({ ...r, place: p.name })));
    const picked = all
      .filter(r => reviewMode === 'complaints' ? r.stars <= 3 : r.stars >= 4)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 12);
    if (!picked.length) {
      ui.reviewList.replaceChildren(h('li', { class: 'empty-state',
        text: all.length ? 'No reviews in this group.' : 'This dataset has no reviews. Set "max reviews" in the Apify scraper and run it again.' }));
      return;
    }
    ui.reviewList.replaceChildren(...picked.map(r => h('li', { class: 'rev-item' },
      h('div', { class: 'rev-top' },
        h('span', { class: 'rev-place', text: r.place }),
        h('span', null,
          h('span', { class: 'rev-stars ' + (r.stars <= 3 ? 'low' : 'high'), text: stars(r.stars) }),
          r.date ? ' · ' + fmtDate(r.date) : '')),
      h('p', { class: 'rev-text', text: r.text.length > 280 ? r.text.slice(0, 277) + '…' : r.text }),
    )));
  }

  function renderTable() {
    const sorted = places.slice().sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.reviewsCount - a.reviewsCount);
    ui.tableBody.replaceChildren(...sorted.map(p => {
      const links = h('td', { class: 'comp-links' });
      const web = safeUrl(p.website);
      const map = safeUrl(p.url);
      if (web) links.append(h('a', { href: web, target: '_blank', rel: 'noopener noreferrer', text: 'Website' }));
      if (map) links.append(h('a', { href: map, target: '_blank', rel: 'noopener noreferrer', text: 'Map' }));
      return h('tr', null,
        h('td', { class: 'td-cat', text: p.name }),
        h('td', { text: p.category || '–' }),
        h('td', { text: p.city || '–' }),
        h('td', { class: 'td-amount col-rating', text: p.rating != null ? p.rating.toFixed(1) + ' ★' : '–' }),
        h('td', { class: 'td-amount col-rating', text: p.reviewsCount.toLocaleString('en-US') }),
        links);
    }));
  }

  function render() {
    ui.empty.classList.add('hidden');
    ui.content.classList.remove('hidden');
    // Ratings/reviews only exist if the scraper was run with them; otherwise
    // hide those parts and show the market map built from what is there.
    const hasRatings = places.some(p => p.rating != null);
    const hasReviews = places.some(p => p.reviews.length);
    [ui.cardAvg, ui.cardReviews, ui.cardTop, ui.ratingsPanel].forEach(el => el.classList.toggle('hidden', !hasRatings));
    ui.reviewsPanel.classList.toggle('hidden', !hasReviews);
    document.querySelectorAll('.col-rating').forEach(el => el.classList.toggle('hidden', !hasRatings));
    renderSummary();
    renderMarketMap();
    renderRatings();
    renderReviews();
    renderTable();
  }

  /* ---------- loading ---------- */
  async function load() {
    let items = null;
    let kind = null;

    if (ApifyData.isConnected()) {
      try {
        items = await ApifyData.fetchLive();
        kind = 'live';
      } catch (err) {
        showToast('Apify live load failed — showing snapshot');
        console.warn(err);
      }
    }
    if (!items) {
      items = await ApifyData.fetchSnapshot();
      if (items) kind = 'snapshot';
    }

    places = ApifyData.normalize(items);
    if (!places.length) {
      setSource('', 'No data');
      showEmpty('No competitor data yet. Run an Apify Google Maps scraper, then open "Apify settings" to connect its dataset — or save the exported JSON as data/competitors.json.');
      return kind;
    }
    setSource(kind, kind === 'live' ? 'Apify · live' : 'Apify · snapshot');
    render();
    return kind;
  }

  /* ---------- settings modal ---------- */
  function refreshStatus() {
    const connected = ApifyData.isConnected();
    ui.status.textContent = connected ? 'Connected — live Apify data.' : 'Not connected.';
    ui.status.classList.toggle('connected', connected);
    ui.btnDisconnect.classList.toggle('hidden', !connected);
  }
  function openSettings() {
    const cfg = ApifyData.getConfig() || {};
    ui.token.value = cfg.token || '';
    ui.datasetId.value = cfg.datasetId || '';
    refreshStatus();
    ui.overlay.classList.remove('hidden');
  }
  function closeSettings() { ui.overlay.classList.add('hidden'); }

  /* ---------- events ---------- */
  ui.tabs.forEach(tab => tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    ui.tabs.forEach(t => t.classList.toggle('active', t === tab));
    ui.viewOverview.classList.toggle('hidden', view !== 'overview');
    ui.viewCompetitors.classList.toggle('hidden', view !== 'competitors');
    if (view === 'competitors' && !loadedOnce) {
      loadedOnce = true;
      load();
    }
  }));

  ui.reviewToggle.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    reviewMode = btn.dataset.mode;
    ui.reviewToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderReviews();
  });

  ui.btnRefresh.addEventListener('click', load);
  ui.btnSettings.addEventListener('click', openSettings);
  ui.close.addEventListener('click', closeSettings);
  ui.overlay.addEventListener('click', e => { if (e.target === ui.overlay) closeSettings(); });

  ui.form.addEventListener('submit', async e => {
    e.preventDefault();
    const token = ui.token.value.trim();
    const datasetId = ui.datasetId.value.trim();
    if (!token || !datasetId) { showToast('Enter both a token and a dataset ID'); return; }
    ApifyData.setConfig({ token, datasetId });
    refreshStatus();
    closeSettings();
    if (await load() === 'live') showToast('Apify connected');
  });

  ui.btnDisconnect.addEventListener('click', async () => {
    ApifyData.clearConfig();
    refreshStatus();
    closeSettings();
    await load();
    showToast('Apify disconnected');
  });
})();
