import { createHash } from 'node:crypto';

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export const HAIRCUT = 0.35;
export const FORMULA = 'implied_value_usd = round(exp(intercept + b1*ln(tvl_usd) + b2*change_7d + b3*ln(age_days) + b4*ln(chain_count)) * haircut)';
export function ageDays(asOf: string, listed: string | null): number {
  return listed ? Math.max(1, Math.floor((Date.parse(asOf) - Date.parse(listed)) / 86400000)) || 1 : 1;
}
export const isPreToken = (p: SnapshotProtocol) => !p.gecko_id && !p.symbol && !(p.mcap_usd! > 0);
type FeatureSet = 'base' | 'chains';
function features(p: SnapshotProtocol, date: string, set: FeatureSet = 'chains'): number[] {
  const x = [1, Math.log(Math.max(1, p.tvl_usd)), p.change_7d ?? 0, Math.log(ageDays(date, p.listed_at))];
  if (set === 'chains') x.push(Math.log(Math.max(1, p.chains.length)));
  return x;
}
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** OLS by Householder QR, avoiding unstable normal equations. No penalties or hand-tuned coefficients. */
export function fit(rows: SnapshotProtocol[], date: string, set: FeatureSet = 'chains'): number[] {
  const a = rows.map(p => [...features(p, date, set), Math.log(p.mcap_usd!)]);
  const width = features(rows[0], date, set).length;
  for (let k = 0; k < width; k++) {
    const norm = Math.hypot(...a.slice(k).map(r => r[k]));
    const v = a.slice(k).map(r => r[k]);
    v[0] += (v[0] >= 0 ? 1 : -1) * norm;
    const vnorm = Math.hypot(...v);
    if (vnorm < 1e-12) throw new Error('Rank-deficient comps design matrix');
    const u = v.map(x => x / vnorm);
    for (let j = k; j <= width; j++) {
      const projection = 2 * u.reduce((s, x, i) => s + x * a[k + i][j], 0);
      u.forEach((x, i) => { a[k + i][j] -= projection * x; });
    }
  }
  const b = Array(width).fill(0);
  for (let k = width - 1; k >= 0; k--) {
    b[k] = (a[k][4] - b.reduce((s, x, j) => s + (j > k ? x * a[k][j] : 0), 0)) / a[k][k];
  }
  return b;
}
function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))];
}
function trimRows(rows: SnapshotProtocol[], date: string, set: FeatureSet, coefficients: number[]) {
  const residuals = rows.map(p => Math.log(p.mcap_usd!) - dot(features(p, date, set), coefficients));
  const lo = quantile(residuals, .05), hi = quantile(residuals, .95);
  return rows.filter((_, i) => residuals[i] >= lo && residuals[i] <= hi);
}
function robustFit(rows: SnapshotProtocol[], date: string, set: FeatureSet) {
  const initial = fit(rows, date, set);
  const kept = trimRows(rows, date, set, initial);
  return { coefficients: fit(kept, date, set), kept };
}
function relativeErrors(rows: SnapshotProtocol[], date: string, set: FeatureSet, coefficients: number[]) {
  return rows.map(p => Math.abs(Math.exp(dot(features(p, date, set), coefficients)) - p.mcap_usd!) / p.mcap_usd!);
}
function median(values: number[]) { return quantile(values, .5); }
function central90Mean(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const central = sorted.slice(Math.floor(sorted.length * .05), Math.ceil(sorted.length * .95));
  return central.reduce((sum, x) => sum + x, 0) / central.length;
}
export function calibrate(s: Snapshot) {
  const comps = s.protocols.filter(p => p.mcap_usd! > 0 && p.tvl_usd > 0);
  // Stable pseudo-random split by SHA256(slug); identity only seeds the split, never the value equation.
  const shuffled = [...comps].sort((a, b) => createHash('sha256').update(a.slug).digest('hex').localeCompare(createHash('sha256').update(b.slug).digest('hex')));
  const test = shuffled.slice(0, Math.ceil(comps.length * .2));
  const train = shuffled.slice(test.length);
  const candidates = (['base', 'chains'] as FeatureSet[]).map(feature_set => {
    const robust = robustFit(train, s.as_of, feature_set);
    const errors = relativeErrors(test, s.as_of, feature_set, robust.coefficients);
    return { feature_set, robust, median: median(errors), trimmed_mape: central90Mean(errors) };
  });
  candidates.sort((a, b) => a.median - b.median || a.trimmed_mape - b.trimmed_mape || (a.feature_set === 'base' ? -1 : 1));
  const winner = candidates[0];
  const final = robustFit(comps, s.as_of, winner.feature_set);
  const coefficients = final.coefficients;
  const finalRows = final.kept;
  const mean = finalRows.reduce((sum, p) => sum + Math.log(p.mcap_usd!), 0) / finalRows.length;
  const residual = finalRows.reduce((sum, p) => sum + (Math.log(p.mcap_usd!) - dot(features(p, s.as_of, winner.feature_set), coefficients)) ** 2, 0);
  const total = finalRows.reduce((sum, p) => sum + (Math.log(p.mcap_usd!) - mean) ** 2, 0);
  const errors = relativeErrors(test, s.as_of, winner.feature_set, winner.robust.coefficients);
  return {
    formula: FORMULA, coefficients, coefficient_names: ['intercept', 'ln_tvl', 'change_7d', 'ln_age_days'],
    feature_set: winner.feature_set, coefficient_names: winner.feature_set === 'chains' ? ['intercept', 'ln_tvl', 'change_7d', 'ln_age_days', 'ln_chain_count'] : ['intercept', 'ln_tvl', 'change_7d', 'ln_age_days'],
    r_squared: 1 - residual / total, oos_median_relative_error_pct: median(errors) * 100, oos_trimmed_mape_pct: winner.trimmed_mape * 100, haircut: HAIRCUT,
    comps_count: comps.length, fit_count: finalRows.length, train_count: train.length, test_count: test.length,
    holdout_coefficients: winner.robust.coefficients, test_slugs: test.map(p => p.slug), trimmed_slugs: comps.filter(p => !finalRows.includes(p)).map(p => p.slug),
    split: '20% held out by SHA256(slug) order; each candidate is fit after trimming the outer 5% of training log residuals; the winner is selected by holdout median relative error; final fit is refit on the central 90% of all comps.',
    preprocessing: 'Natural logs. change_7d in percentage points, un-clipped; missing growth = 0. Age from snapshot.as_of minus listed_at; missing/future/zero age = 1 day. TVL and chain count floors = 1. R² measured in log market cap on retained comps. OOS median relative error is used because a few tiny-cap misses dominate mean MAPE; trimmed MAPE is the mean dollar-relative error on the central 90% of holdout errors, both before haircut.',
  };
}

/** Costs are executable budget ceilings, not fee/APY observations: those fields are absent in the snapshot. */
function farmPlan(p: SnapshotProtocol, age: number) {
  const capital = p.tvl_usd >= 1e8 ? 100 : 50;
  const chain = p.chains[0] ?? 'the listed network';
  const gas = /Ethereum|Bitcoin/.test(chain) ? 5 : 1;
  const c = (p.category ?? '').toLowerCase();
  let enter: string, follow: string, exit: string;
  if (/lend|cdp/.test(c)) {
    enter = `Supply $${capital} of a supported stablecoin to ${p.name}'s lending market on ${chain}; for a CDP, deposit accepted collateral without minting debt`;
    follow = `Withdraw $10 of the supplied asset from ${p.name}, then resupply once to test the withdrawal path; use $0 of borrowing`;
    exit = `Withdraw all remaining collateral and accrued supply interest from ${p.name}; repay any existing debt before unlocking collateral`;
  } else if (/dex|liquidity|farm/.test(c)) {
    enter = `Add $${capital / 2} each of two supported assets to a liquid ${p.name} pool on ${chain}; approve only $${capital} total`;
    follow = `Make one $10 swap in ${p.name}; accept at most a 0.30% pool fee ($0.03) and 0.50% slippage ($0.05)`;
    exit = `Remove the full ${p.name} LP position and collect accrued fees; compare both returned assets with the original $${capital} deposit`;
  } else if (/bridge|chain|payments/.test(c)) {
    enter = `Transfer $${capital} of a supported asset through ${p.name}'s documented route on ${chain}; confirm the destination supports a return route`;
    follow = `Return $10 using ${p.name}'s supported route; accept at most 0.30% ($0.03) routing cost and check the actual received balance`;
    exit = `Return the remaining ${p.name} balance through its documented exit route; retain enough native gas on both networks`;
  } else if (/staking|restak|collateral|btc/.test(c)) {
    enter = `Deposit $${capital} of the accepted native or staking asset into ${p.name} on ${chain}; record the receipt token and unbonding period`;
    follow = `Inspect ${p.name}'s receipt balance and reward accrual after 14 days; request a $10 test redemption if partial exits are supported`;
    exit = `Request redemption of all ${p.name} receipts; claim the underlying asset after the app's stated unbonding queue`;
  } else if (/derivative|prediction|options|otc/.test(c)) {
    enter = `Deposit $${capital} of supported collateral into ${p.name} on ${chain}; cap one fully collateralized position at $10 without leverage`;
    follow = `Close or settle the $10 position in ${p.name}; cap trading fees at 0.30% per side ($0.03 each) and record realized proceeds`;
    exit = `Cancel remaining orders in ${p.name}, settle positions, and withdraw unused collateral through the account withdrawal panel`;
  } else {
    enter = `Deposit $${capital} of the accepted underlying asset into ${p.name}'s ${p.category ?? 'deposit'} product on ${chain}; confirm the minimum and access rules first`;
    follow = `Request a $10 test redemption from ${p.name} after 14 days if supported; inspect share value, accrued yield and the withdrawal queue`;
    exit = `Redeem all remaining ${p.name} shares through the documented withdrawal window and record the actual net underlying returned`;
  }
  const hold = age < 180 ? 45 : 30;
  return [
    `Prepare ${chain} funds for ${p.name}: earmark $${capital} principal plus $${gas * 4 + 1} fee reserve. Check accepted assets, access and exit rules in the official app; skip if minimum exceeds budget. Cost: $0 inspection. Time: 10 min, day 0.`,
    `${enter}. Cost: $${capital} recoverable principal, gas ceiling $${gas}; deposit fee ceiling 0.10% ($${(capital * .001).toFixed(2)}). Time: 15 min on day 1. Skip if the app's quote exceeds either ceiling.`,
    `${follow}. Cost: $0 new capital, gas ceiling $${gas} per transaction; two transactions maximum. Time: 10 min on day 14 plus displayed settlement delay.`,
    `Hold ${p.name} for ${hold} days and record the actual displayed APY weekly. Snapshot APY and current fees are unavailable: budget 0% yield ($0 income); at a quoted 5% APY, $${capital} would earn $${(capital * .05 * hold / 365).toFixed(2)} over ${hold} days before fees. Cost: $0 new capital. Time: 5 min/week.`,
    `${exit}. Cost: gas ceiling $${gas}, redemption fee ceiling 0.10% ($${(capital * .001).toFixed(2)}); skip entry if exit terms exceed budget. Time: 15 min at day ${hold}, plus the app's quoted queue; verify it before deposit.`,
    `Reconcile ${p.name} entry/exit hashes and returned principal against the $${capital} budget. Record all USD fees; inspect rewards only if officially offered. Cost: $0 to log; total network budget $${gas * 4}, fee reserve $1. Time: 10 min after settlement.`,
  ];
}

export function buildRadar(snapshot: Snapshot) {
  const model = calibrate(snapshot);
  const predict = (p: SnapshotProtocol) => Math.round(Math.exp(dot(features(p, snapshot.as_of, model.feature_set), model.coefficients)) * model.haircut);
  const watch = new Set(snapshot.watchlist);
  const watchProtocols = snapshot.protocols.filter(p => watch.has(p.slug));
  const floor = Math.min(...watchProtocols.map(predict));
  const extras = snapshot.protocols.filter(p => !watch.has(p.slug) && isPreToken(p) && p.category !== 'CEX' && predict(p) <= floor)
    .sort((a, b) => predict(b) - predict(a) || a.slug.localeCompare(b.slug)).slice(0, 100);
  const comps = snapshot.protocols.filter(p => p.mcap_usd! > 0 && p.tvl_usd > 0);
  const board = [...watchProtocols, ...extras].map(p => {
    const age = ageDays(snapshot.as_of, p.listed_at);
     const x = features(p, snapshot.as_of, model.feature_set);
    const logPrediction = dot(x, model.coefficients);
    const neighbours = [...comps].sort((a, b) => Math.abs(Math.log(a.tvl_usd / Math.max(1, p.tvl_usd))) - Math.abs(Math.log(b.tvl_usd / Math.max(1, p.tvl_usd)))).slice(0, 3).map(c => ({ name: c.name, slug: c.slug, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, change_7d: c.change_7d, age_days: ageDays(snapshot.as_of, c.listed_at) }));
    return { ...p, rank: 0, watchlist: watch.has(p.slug), token_status: 'pre-token', age_days: age,
       implied_value_usd: predict(p),
      model: { ...model, inputs: x, log_prediction: logPrediction },
      comps_neighbours: neighbours, farm_steps: farmPlan(p, age),
    };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  board.forEach((p, i) => { p.rank = i + 1; });
  const live = snapshot.protocols.filter(p => !isPreToken(p)).map(p => ({ ...p, token_status: 'listed', age_days: ageDays(snapshot.as_of, p.listed_at) })).sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0));
  // Shared model metadata is stored once for the dashboard; full audit metadata remains in every board row.
  const rows = board.map(({ model: rowModel, ...p }) => ({ ...p, model_inputs: rowModel.inputs }));
  return { board, radar: { as_of: snapshot.as_of, model, rows, live, watchlist_size: watch.size, board_size: board.length, early_size: extras.length, live_size: live.length } };
}
export type BoardRow = ReturnType<typeof buildRadar>['board'][number];
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!s.as_of || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('Invalid snapshot');
  return s;
}
export function boardIssue(board: BoardRow[], s: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return 'Expected 100–4000 rows';
  const slugs = new Set(board.map(p => p.slug));
  if (slugs.size !== board.length || s.watchlist.some(slug => !slugs.has(slug))) return 'Duplicate slug or missing watchlist entry';
  for (const [i, p] of board.entries()) {
    if (p.rank !== i + 1 || !Number.isSafeInteger(p.implied_value_usd) || p.implied_value_usd < 1 || (i && p.implied_value_usd > board[i - 1].implied_value_usd)) return 'Invalid rank/value';
    if (p.name !== s.protocols.find(q => q.slug === p.slug)?.name || !isPreToken(p)) return 'Invalid identity/status';
    if (p.farm_steps.length < 3 || p.farm_steps.length > 12 || p.farm_steps.some(t => t.trim().length < 20 || t.length > 600)) return 'Invalid farm steps';
  }
  return null;
}
export function dataScript(radar: ReturnType<typeof buildRadar>['radar']) {
  return `window.RADAR=${JSON.stringify(radar).replace(/</g, '\\u003c')};\n`;
}
