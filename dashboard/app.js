/* One dataset feeds rankings, details and captures; coefficients are fitted by lib/model.ts. */
'use strict';
const D = window.RADAR, M = D.model;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = n => n == null ? '—' : '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toLocaleString('en-US'));
const exact = n => '$' + Math.round(n).toLocaleString('en-US');
const pct = n => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
let live = false, sort = 'implied_value_usd', direction = -1;
$('date').textContent = D.as_of;
$('coverage').textContent = D.watchlist_size + ' / ' + D.watchlist_size;
$('count').textContent = D.rows.length;
$('live-count').textContent = D.live.length;
$('metrics').innerHTML = [
  ['RADAR COVERAGE', D.watchlist_size + '<span>/ ' + D.watchlist_size + ' watchlist</span>', D.board_size + ' ranked · ' + D.early_size + ' below the watchlist'],
  ['LISTED MARKET COMPS', M.comps_count, 'TVL + 7D growth + age + ' + (M.feature_set === 'chains' ? 'chain breadth' : 'base features')],
  ['MODEL FIT / LOG SPACE', M.r_squared.toFixed(3) + '<span>R²</span>', 'Robust OLS · central comps refit'],
  ['OUT-OF-SAMPLE ERROR', M.oos_median_relative_error_pct.toFixed(0) + '<span>% median error</span>', 'trimmed MAPE ' + M.oos_trimmed_mape_pct.toFixed(0) + '% · before haircut'],
].map(([label,value,note]) => `<div class="metric"><label>${label}</label><strong>${value}</strong><small>${note}</small></div>`).join('');
$('preprocessing').textContent = M.preprocessing;
 $('band-fit').textContent = `R² ${M.r_squared.toFixed(4)} · median OOS error ${M.oos_median_relative_error_pct.toFixed(0)}% · central-90% MAPE ${M.oos_trimmed_mape_pct.toFixed(0)}%`;
$('band-haircut').textContent = `${(M.haircut * 100).toFixed(0)}% retained`;
 $('coefficients').innerHTML = M.coefficients.map((b,i) => `<div class="coefficient"><span>${['b0 / intercept','bTVL / ln(TVL USD)','b7d / percentage point','bAge / ln(age days)','bChains / ln(chain count)'][i]}</span><b>${b.toFixed(6)}</b></div>`).join('');
 $('validation').textContent = `${M.comps_count} listed comps. R² = ${M.r_squared.toFixed(4)} in log space. Median OOS relative error = ${M.oos_median_relative_error_pct.toFixed(2)}%; central-90% OOS MAPE = ${M.oos_trimmed_mape_pct.toFixed(2)}%, both before the haircut. ${M.split} Selected ${M.feature_set} features by holdout median error; final fit retains ${M.fit_count} comps.`;
function options() {
  const source = live ? D.live : D.rows;
  for (const [id,values] of [['category',source.map(p=>p.category).filter(Boolean)],['chain',source.flatMap(p=>p.chains)]]) {
    const previous = $(id).value;
    $(id).innerHTML = `<option value="">All ${id === 'chain' ? 'chains' : 'categories'}</option>` + [...new Set(values)].sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (values.includes(previous)) $(id).value = previous;
  }
}
function visibleRows() {
  const q = $('search').value.trim().toLowerCase();
  const key = live && sort === 'implied_value_usd' ? 'mcap_usd' : sort;
  return (live ? D.live : D.rows).filter(p => (!q || [p.name,p.slug,p.category,...p.chains].join(' ').toLowerCase().includes(q)) && (!$('category').value || p.category === $('category').value) && (!$('chain').value || p.chains.includes($('chain').value)) && (!$('watch').checked || p.watchlist)).sort((a,b) => {
    const x = a[key] ?? -Infinity, y = b[key] ?? -Infinity;
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - y) * direction || a.slug.localeCompare(b.slug);
  });
}
function render() {
  const rows = visibleRows();
   $('rows').innerHTML = rows.map((p,i) => `<tr data-slug="${esc(p.slug)}"><td>${live ? String(i+1).padStart(2,'0') : String(p.rank).padStart(2,'0')}</td><td><span class="icon" aria-hidden="true">${esc(p.name.slice(0,1))}</span><button class="name" data-open="${esc(p.slug)}">${esc(p.name)}</button>${p.watchlist ? '<span class="tag">WATCH</span>' : ''}<small>${esc(p.chains.slice(0,2).join(' / '))}${p.chains.length > 2 ? ' +' + (p.chains.length-2) : ''}</small></td><td>${usd(live ? p.mcap_usd : p.implied_value_usd)}<small>${live ? 'Observed market cap' : 'Regression × haircut'}</small></td><td>${usd(p.tvl_usd)}</td><td class="${p.change_7d >= 0 ? 'positive':'negative'}">${pct(p.change_7d)}</td><td>${live ? Math.max(1,Math.floor((Date.parse(D.as_of)-Date.parse(p.listed_at))/86400000)) || '—' : p.age_days}<small>days listed</small></td><td><span class="category-tag">${esc(p.category ?? 'Unclassified')}</span></td><td><button data-open="${esc(p.slug)}" aria-label="Inspect ${esc(p.name)}">↗</button></td></tr>`).join('');
  $('results').textContent = `${rows.length} / ${live ? D.live.length : D.rows.length} protocols · ${live ? 'Already trading · excluded from pre-token ranks' : D.watchlist_size + ' watchlist covered · pre-token only'}`;
  $('sort-note').textContent = `SORT: ${live && sort === 'implied_value_usd' ? 'MARKET CAP' : sort.replaceAll('_',' ').toUpperCase()} ${direction === -1 ? '↓' : '↑'}`;
  $('empty').hidden = !!rows.length;
  $('value-head').textContent = live ? 'Market cap ↕' : 'Implied value ↕';
  document.querySelectorAll('th button').forEach(b => b.parentElement.setAttribute('aria-sort', b.dataset.sort === sort ? direction === -1 ? 'descending':'ascending' : 'none'));
}
function openDetail(slug) {
  const p = (live ? D.live : D.rows).find(r => r.slug === slug);
  if (!p) return;
  const age = p.age_days ?? Math.max(1,Math.floor((Date.parse(D.as_of)-Date.parse(p.listed_at))/86400000));
  const value = live ? p.mcap_usd : p.implied_value_usd;
  const b = M.coefficients;
  const logPrediction = live ? null : p.model_inputs.reduce((sum, x, i) => sum + x * b[i], 0);
  const trace = live ? '' : `<section class="regression-trace"><h3>OLS comps regression · calculation trace</h3>
     <p class="trace-fit">R² ${M.r_squared.toFixed(4)} · median OOS error ${M.oos_median_relative_error_pct.toFixed(2)}% · central-90% MAPE ${M.oos_trimmed_mape_pct.toFixed(2)}% · Haircut ${M.haircut} (${M.haircut * 100}% retained)</p>
     <p class="trace-coefficients">Fitted ${M.feature_set} coefficients: ${M.coefficients.map((x,i)=>`${M.coefficient_names[i]} = ${x}`).join(' · ')}</p>
     <code class="arithmetic">${esc(M.formula)}<br>
       = round(exp(${b[0]} + (${b[1]})·ln(${p.tvl_usd}) + (${b[2]})·${p.change_7d ?? 0} + (${b[3]})·ln(${age})${M.feature_set === 'chains' ? ` + (${b[4]})·ln(${p.chains.length})` : ''}) × ${M.haircut})<br>
      = round(exp(${logPrediction}) × ${M.haircut}) = ${exact(value)}</code>
     <p class="trace-note">Natural logs; chain count is the number of listed chains. Median relative error is reported because a few extreme misses dominate mean MAPE; central-90% MAPE shows typical worst-case scale. ${M.train_count} training / ${M.test_count} held out; final robust fit retains ${M.fit_count} of ${M.comps_count} comps.</p></section>`;
  $('detail-content').innerHTML = `<div class="detail-top"><div><p class="eyebrow">PROTOCOL DOSSIER / ${live ? 'ALREADY TRADING' : '#' + String(p.rank).padStart(2,'0') + ' · PRE-TOKEN'}</p><h2 id="detail-title">${esc(p.name)}</h2><p>${esc(p.category)} · ${esc(p.chains.join(' / '))} · ${esc(p.slug)}</p></div><button class="close" aria-label="Close protocol detail">×</button></div>
    <div class="detail-body"><div class="detail-summary"><div class="value-card"><label>${live ? 'OBSERVED MARKET CAP' : 'IMPLIED TOKEN VALUE / USD'}</label><strong>${value == null ? 'Not available' : exact(value)}</strong><p>${live ? 'Listed token · excluded from pre-token ranks' : `OLS prediction × ${M.haircut} haircut, rounded`}</p></div><div class="input-grid"><div><label>TVL / USD</label><strong>${exact(p.tvl_usd)}</strong></div><div><label>7D CHANGE / PP</label><strong>${p.change_7d ?? 'Missing → 0'}</strong></div><div><label>AGE / DAYS</label><strong>${age}</strong></div><div><label>LISTED AT</label><strong>${esc(p.listed_at ?? 'Missing → 1d')}</strong></div></div></div>
    ${trace}<div class="detail-columns"><section>${!live ? `<h3>Calibration comps · nearest neighbours</h3>${p.comps_neighbours.map(c=>`<div class="comp"><span>${esc(c.name)}<small>${usd(c.tvl_usd)} TVL · ${pct(c.change_7d)} / 7D · ${c.age_days} days</small></span><b>${usd(c.mcap_usd)}<small>market cap</small></b></div>`).join('')}<p class="detail-note">Three nearest by absolute log TVL distance, drawn from the ${M.comps_count} listed protocols used to fit the regression.</p>` : '<p class="detail-note">Listed protocols with positive TVL and market cap contribute to OLS calibration.</p>'}</section><section>${!live ? `<div class="plan-head"><h3>The farm plan</h3><span>USD BUDGETS / SIX STEPS</span></div><ol class="plan">${p.farm_steps.map(t=>`<li>${esc(t).replace(/Cost:|Time:/g, x=>'<b>'+x+'</b>')}</li>`).join('')}</ol>` : `<h3>Market reference</h3><p>This protocol already has a token identifier: ${esc(p.symbol || p.gecko_id || 'market cap available')}.</p>`}</section></div></div>`;
  $('detail').showModal();
  $('detail').scrollTop = 0;
  $('detail-content').querySelector('.close').onclick = () => $('detail').close();
}
$('rows').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openDetail(b.dataset.open); });
$('detail').addEventListener('click', e => { if (e.target === $('detail')) { const r = $('detail').getBoundingClientRect(); if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) $('detail').close(); } });
for (const id of ['search','category','chain','watch']) $(id).addEventListener(id === 'search' ? 'input':'change', render);
document.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {direction = sort === b.dataset.sort ? -direction : ['name','category','rank'].includes(b.dataset.sort) ? 1 : -1; sort = b.dataset.sort; render();});
$('reset').onclick = () => { $('search').value=''; $('category').value=''; $('chain').value=''; $('watch').checked=false; render(); };
for (const id of ['pre','live']) $(id).onclick = () => { live = id === 'live'; $('pre').classList.toggle('active',!live); $('live').classList.toggle('active',live); $('watch').checked=false; $('watch').disabled=live; options(); render(); };
options(); render();
