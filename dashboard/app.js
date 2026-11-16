(() => {
  'use strict';
  const data = window.RADAR;
  const $ = (id) => document.getElementById(id);
  if (!data || !Array.isArray(data.rows)) {
    $('results').textContent = 'Snapshot unavailable. Build the output and open its dashboard to load the local data.';
    return;
  }
  const state = { query: '', category: null, sort: 'implied_value_usd', direction: -1 };
  const labels = { name: 'Protocol', implied_value_usd: 'Implied value', tvl_usd: 'TVL', growth_pct: '7d change', age_months: 'Age', category: 'Category' };
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  const category = (row) => row.category || 'Uncategorized';
  const known = (value) => typeof value === 'number' && Number.isFinite(value);
  const compact = (value) => {
    if (!known(value)) return 'Unknown';
    for (const [unit, divisor] of [['B', 1e9], ['M', 1e6], ['K', 1e3]]) {
      if (Math.abs(value) >= divisor) return '$' + (value / divisor).toFixed(2) + unit;
    }
    return money.format(value);
  };
  const pct = (value) => known(value) ? (value > 0 ? '+' : '') + value.toFixed(2) + '%' : 'Unknown';
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const rows = data.rows;
  const maxValue = Math.max(1, ...rows.map((row) => row.implied_value_usd));
  $('date').textContent = data.as_of;
  $('date').dateTime = data.as_of;
  $('version').textContent = String(data.model_version).toUpperCase() + ' MODEL';
  const stats = [
    ['Protocols tracked', String(rows.length).padStart(3, '0'), 'Ranked by implied value'],
    ['Watchlist covered', data.watchlist_size + ' / ' + data.watchlist_size, compact(data.floor_usd) + ' TVL floor'],
    ['Early signals', data.early_size, 'Below the watchlist floor'],
    ['Combined TVL', compact(rows.reduce((sum, row) => sum + row.tvl_usd, 0)), data.live_size + ' live-token protocols set aside']
  ];
  stats.forEach(([label, value, note]) => {
    const card = node('div', 'metric');
    card.append(node('span', 'metric-label', label), node('strong', '', value), node('small', '', note));
    $('metrics').append(card);
  });
  const counts = new Map();
  rows.forEach((row) => counts.set(category(row), (counts.get(category(row)) || 0) + 1));
  const chipEntries = [[null, rows.length], ...Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))];
  chipEntries.forEach(([name, count]) => {
    const chip = node('button', 'chip', name || 'All sectors');
    chip.type = 'button';
    chip.append(node('span', '', count));
    chip.setAttribute('aria-pressed', String(name === state.category));
    chip.addEventListener('click', () => { state.category = name; render(); });
    $('categories').append(chip);
  });
  function reset() {
    state.query = '';
    state.category = null;
    $('search').value = '';
    render();
  }
  $('reset').addEventListener('click', reset);
  $('empty-reset').addEventListener('click', reset);
  $('search').addEventListener('input', (event) => { state.query = event.target.value; render(); });
  const sortButtons = Array.from(document.querySelectorAll('[data-sort]'));
  sortButtons.forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.sort;
    state.direction = state.sort === key ? -state.direction : (key === 'category' || key === 'name' ? 1 : -1);
    state.sort = key;
    render();
  }));
  function render() {
    const query = state.query.trim().toLocaleLowerCase();
    const list = rows.filter((row) => (!state.category || category(row) === state.category) &&
      [row.name, row.slug, category(row), ...(row.chains || [])].join(' ').toLocaleLowerCase().includes(query));
    list.sort((a, b) => {
      const av = state.sort === 'category' ? category(a) : a[state.sort];
      const bv = state.sort === 'category' ? category(b) : b[state.sort];
      // Missing ages stay last in either direction; original rank breaks ties.
      if (av == null || bv == null) return av == null && bv == null ? a.rank - b.rank : av == null ? 1 : -1;
      const order = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return order * state.direction || a.rank - b.rank;
    });
    const filtered = Boolean(query || state.category);
    $('results').textContent = (filtered ? 'FILTERED' : 'ALL SIGNALS') + ' / ' + list.length + ' of ' + rows.length + ' protocols' +
      (state.category ? ' · ' + state.category : '') + (query ? ' · “' + state.query.trim() + '”' : '');
    $('results').parentElement.classList.toggle('filtered', filtered);
    $('reset').disabled = !filtered;
    $('sort-status').textContent = 'SORT: ' + labels[state.sort].toUpperCase() + (state.direction < 0 ? ' ↓' : ' ↑');
    Array.from($('categories').children).forEach((chip, index) => chip.setAttribute('aria-pressed', String(chipEntries[index][0] === state.category)));
    sortButtons.forEach((button) => {
      const active = button.dataset.sort === state.sort;
      button.parentElement.setAttribute('aria-sort', active ? (state.direction > 0 ? 'ascending' : 'descending') : 'none');
      button.querySelector('span').textContent = active ? (state.direction > 0 ? '↑' : '↓') : '↕';
    });
    const fragment = document.createDocumentFragment();
    list.forEach((row) => {
      const tr = node('tr');
      const rank = node('td');
      rank.append(node('span', 'rank' + (row.rank <= 3 ? ' top' : ''), String(row.rank).padStart(2, '0')));
      const identity = node('td');
      const button = node('button', 'protocol', row.name);
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      identity.append(button, node('span', 'chains', (row.chains || []).join(' · ') || 'Chain unspecified'));
      const value = node('td', 'num value', compact(row.implied_value_usd));
      const track = node('span', 'track');
      track.setAttribute('aria-hidden', 'true');
      const bar = node('i');
      bar.style.width = Math.max(2, row.implied_value_usd / maxValue * 100) + '%';
      track.append(bar);
      value.append(track);
      const change = node('td', 'num');
      const growth = row.change_7d == null ? null : row.growth_pct;
      const trend = !known(growth) || growth === 0 ? 'neutral' : growth > 0 ? 'positive' : 'negative';
      change.append(node('span', 'growth ' + trend, (known(growth) ? (growth > 0 ? '↗ ' : growth < 0 ? '↘ ' : '→ ') : '— ') + pct(growth)));
      tr.append(rank, identity, value, node('td', 'num', compact(row.tvl_usd)), change,
        node('td', 'num', known(row.age_months) ? row.age_months.toFixed(1) + ' mo' : 'Unknown'),
        node('td', 'category', category(row)), node('td', 'arrow', '↗'));
      tr.addEventListener('click', () => openDetail(row, button));
      fragment.append(tr);
    });
    $('rows').replaceChildren(fragment);
    $('empty').hidden = list.length !== 0;
  }
  const dialog = $('detail');
  let returnFocus = null;
  dialog.addEventListener('close', () => { if (returnFocus && returnFocus.isConnected) returnFocus.focus(); });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  function openDetail(row, trigger) {
    returnFocus = trigger;
    const head = node('header', 'detail-head');
    const top = node('div', 'detail-top');
    const close = node('button', 'close', 'Close ×');
    close.type = 'button';
    close.autofocus = true;
    close.setAttribute('aria-label', 'Close protocol details');
    close.addEventListener('click', () => dialog.close());
    top.append(node('p', 'eyebrow', 'SIGNAL DOSSIER / RANK ' + row.rank), close);
    const title = node('h2', '', row.name);
    title.id = 'detail-title';
    head.append(top, title, node('p', 'detail-sub', category(row) + ' · ' + ((row.chains || []).join(' / ') || 'Chain unspecified')));
    const model = node('section', 'detail-section');
    model.append(node('p', 'eyebrow', '01 / VALUE MODEL'), node('h3', '', 'Trace the estimate'));
    const components = node('dl', 'components');
    const fields = [
      ['tvl_usd', money.format(row.tvl_usd)],
      ['growth_pct', number.format(row.growth_pct) + '%' + (row.change_7d == null ? ' (fallback)' : '')],
      ['age_months', known(row.age_months) ? number.format(row.age_months) : 'Unknown'],
      ['category', category(row)], ['weight', number.format(row.weight)],
      ['implied_value_usd', money.format(row.implied_value_usd)]
    ];
    fields.forEach(([label, value]) => {
      const cell = node('div', 'component' + (label === 'implied_value_usd' ? ' result' : ''));
      cell.append(node('dt', '', label), node('dd', '', value));
      components.append(cell);
    });
    const m = data.model;
    model.append(components,
      node('p', 'formula', money.format(row.tvl_usd) + ' × ' + row.weight + ' × ' + row.growth_multiplier + ' × ' + row.maturity_multiplier + ' ≈ ' + money.format(row.implied_value_usd)),
      node('p', 'detail-note', 'Weight = base ' + m.base_multiple + ' × category ' + row.category_weight + ' × chain breadth ' + row.chain_multiplier + '. Growth is clipped to ' + m.growth_floor + '%…' + m.growth_cap + '% and scaled by ' + m.growth_weight + '. Maturity ranges from ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range) + ' over ' + m.maturity_days + ' days; unknown age uses ' + m.unknown_age_days + ' days. Displayed multipliers are rounded; the estimate uses full precision.'));
    const plan = node('section', 'detail-section');
    const steps = Array.isArray(row.farm_steps) ? row.farm_steps : [];
    plan.append(node('p', 'eyebrow', '02 / FIELD PLAN'), node('h3', '', 'Farm steps'), node('p', 'plan-count', steps.length + ' steps · Complete plan from the snapshot model'));
    const list = node('ol', 'steps');
    steps.forEach((step) => list.append(node('li', '', step)));
    plan.append(list);
    if (!steps.length) plan.append(node('p', 'detail-note', 'No farm steps supplied for this protocol.'));
    $('detail-content').replaceChildren(head, model, plan);
    dialog.scrollTop = 0;
    dialog.showModal();
  }
  render();
})();
