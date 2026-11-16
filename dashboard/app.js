(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const data = window.RADAR;
  if (!data || !Array.isArray(data.rows)) {
    $('results').textContent = 'Snapshot unavailable. Generate the output, then open out/dashboard/index.html.';
    $('search').disabled = true;
    return;
  }
  const rows = data.rows;
  const state = { query: '', category: null, sort: 'implied_value_usd', direction: -1 };
  const labels = { name: 'Protocol', implied_value_usd: 'Implied value', tvl_usd: 'TVL', growth_pct: '7d change', age_months: 'Age', category: 'Category' };
  const known = (n) => typeof n === 'number' && Number.isFinite(n);
  const sector = (row) => row.category || 'Uncategorized';
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  const compact = (n) => {
    if (!known(n)) return 'Unknown';
    for (const [unit, divisor] of [['B', 1e9], ['M', 1e6], ['K', 1e3]]) {
      if (Math.abs(n) >= divisor) return '$' + (n / divisor).toFixed(2) + unit;
    }
    return money.format(n);
  };
  const pct = (n) => known(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : 'Unknown';
  // The table shows the observed week; the drawer also shows the clipped model input.
  const observedGrowth = (row) => 'change_7d' in row ? row.change_7d : row.growth_pct;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const maxValue = Math.max(1, ...rows.map((row) => row.implied_value_usd));
  $('date').textContent = data.as_of || 'Undated';
  if (data.as_of) $('date').dateTime = data.as_of;
  $('version').textContent = (data.model_version || 'Snapshot') + ' MODEL';
  const methodology = node('p', 'detail-note', 'Methodology: TVL × base multiple × category × chain breadth × clipped weekly growth factor × capped listing maturity, rounded to dollars (minimum $1).');
  methodology.style.padding = '0 24px 16px';
  $('board').append(methodology);
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
  rows.forEach((row) => counts.set(sector(row), (counts.get(sector(row)) || 0) + 1));
  const categories = [[null, rows.length], ...Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))];
  categories.forEach(([name, count]) => {
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
  function sortValue(row) {
    if (state.sort === 'category') return sector(row);
    if (state.sort === 'growth_pct') return observedGrowth(row);
    return row[state.sort];
  }
  function render() {
    const query = state.query.trim().toLocaleLowerCase();
    const list = rows.filter((row) => (!state.category || sector(row) === state.category) &&
      [row.name, row.slug, sector(row), ...(row.chains || [])].join(' ').toLocaleLowerCase().includes(query));
    list.sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av == null || bv == null) return av == null && bv == null ? a.rank - b.rank : av == null ? 1 : -1;
      const order = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return order * state.direction || a.rank - b.rank;
    });
    const filtered = Boolean(query || state.category);
    $('results').textContent = (filtered ? 'FILTERED SIGNALS' : 'FULL RADAR') + ' / ' + list.length + ' of ' + rows.length + ' protocols' +
      (state.category ? ' · ' + state.category : '') + (query ? ' · “' + state.query.trim() + '”' : '');
    $('result-bar').classList.toggle('filtered', filtered);
    $('reset').disabled = !filtered;
    $('sort-status').textContent = 'SORT: ' + labels[state.sort].toUpperCase() + (state.direction < 0 ? ' ↓' : ' ↑');
    Array.from($('categories').children).forEach((chip, index) => chip.setAttribute('aria-pressed', String(categories[index][0] === state.category)));
    sortButtons.forEach((button) => {
      const active = button.dataset.sort === state.sort;
      button.parentElement.setAttribute('aria-sort', active ? (state.direction > 0 ? 'ascending' : 'descending') : 'none');
      button.querySelector('span').textContent = active ? (state.direction > 0 ? '↑' : '↓') : '↕';
    });
    const fragment = document.createDocumentFragment();
    list.forEach((row) => {
      const tr = node('tr');
      tr.dataset.slug = row.slug;
      const rank = node('td');
      rank.append(node('span', 'rank' + (row.rank <= 3 ? ' top' : ''), String(row.rank).padStart(2, '0')));
      const identity = node('td');
      const button = node('button', 'protocol', row.name);
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'detail');
      identity.append(button, node('span', 'chains', (row.chains || []).join(' · ') || 'Chain unspecified'));
      const value = node('td', 'num value', compact(row.implied_value_usd));
      value.title = money.format(row.implied_value_usd);
      const track = node('span', 'track');
      track.setAttribute('aria-hidden', 'true');
      const bar = node('i');
      bar.style.width = Math.max(2, row.implied_value_usd / maxValue * 100) + '%';
      track.append(bar);
      value.append(track);
      const growth = observedGrowth(row);
      const trend = !known(growth) || growth === 0 ? 'neutral' : growth > 0 ? 'positive' : 'negative';
      const change = node('td', 'num');
      change.append(node('span', 'growth ' + trend, (known(growth) ? (growth > 0 ? '↗ ' : growth < 0 ? '↘ ' : '→ ') : '— ') + pct(growth)));
      tr.append(rank, identity, value, node('td', 'num', compact(row.tvl_usd)), change,
        node('td', 'num', known(row.age_months) ? row.age_months.toFixed(1) + ' mo' : 'Unknown'),
        node('td', 'category', sector(row)), node('td', 'arrow', '↗'));
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
    head.append(top, title, node('p', 'detail-sub', sector(row) + ' · ' + ((row.chains || []).join(' / ') || 'Chain unspecified')),
      node('p', 'detail-sub', row.value_note));
    const model = node('section', 'detail-section');
    model.append(node('p', 'eyebrow', '01 / VALUE COMPONENTS'), node('h3', '', 'Trace the estimate'));
    const components = node('dl', 'components');
    const fields = [
      ['TVL', money.format(row.tvl_usd)], ['Observed 7d change', pct(observedGrowth(row))],
      ['Model growth (clipped)', pct(row.growth_pct)], ['Age since listing', known(row.age_months) ? decimal.format(row.age_months) + ' months' : 'Unknown / fallback used'],
      ['Category', sector(row)], ['Combined weight', decimal.format(row.weight) + '×'],
      ['Growth multiplier', decimal.format(row.growth_multiplier) + '×'], ['Maturity multiplier', decimal.format(row.maturity_multiplier) + '×'],
      ['Category weight', decimal.format(row.category_weight) + '×'], ['Chain breadth', decimal.format(row.chain_multiplier) + '×'],
      ['Implied value', money.format(row.implied_value_usd)]
    ];
    fields.forEach(([label, value]) => {
      const cell = node('div', 'component' + (label === 'Implied value' ? ' result' : ''));
      cell.append(node('dt', '', label), node('dd', '', value));
      components.append(cell);
    });
    model.append(components, node('p', 'formula', money.format(row.tvl_usd) + ' × ' + row.weight + ' × ' + row.growth_multiplier + ' × ' + row.maturity_multiplier + ' ≈ ' + money.format(row.implied_value_usd)));
    if (data.model) {
      const m = data.model;
      model.append(node('p', 'detail-note', 'Weight = base ' + m.base_multiple + ' × category weight × chain breadth. Growth is clipped to ' + m.growth_floor + '%…' + m.growth_cap + '% and scaled by ' + m.growth_weight + '. Maturity starts at ' + m.maturity_floor + ', adds up to ' + m.maturity_range + ' over ' + m.maturity_days + ' days, and uses ' + m.unknown_age_days + ' days for unknown age. Displayed multipliers are rounded; the estimate uses full precision.'));
    }
    const plan = node('section', 'detail-section');
    const steps = Array.isArray(row.farm_steps) ? row.farm_steps : [];
    plan.append(node('p', 'eyebrow', '02 / FIELD PLAN'), node('h3', '', 'Complete farm plan'), node('p', 'plan-count', steps.length + ' steps / Actions, costs and timing'));
    const list = node('ol', 'steps');
    steps.forEach((step) => list.append(node('li', '', step)));
    plan.append(list);
    if (!steps.length) plan.append(node('p', 'detail-note', 'No farm plan supplied for this protocol.'));
    $('detail-content').replaceChildren(head, model, plan);
    dialog.showModal();
    dialog.scrollTop = 0;
  }
  render();
})();
