# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aijaz52/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/aijaz52/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A snapshot-based radar for pre-token protocols, ranked by a robust regression fitted on listed market caps: `implied_value_usd = round(exp(intercept + b1*ln(tvl_usd) + b2*change_7d + b3*ln(age_days) + b4*ln(chain_count)) * haircut)`, with `haircut = 0.35`. Every watchlist protocol is included, followed by 100 non-watchlist protocols with lower model values. The dashboard separates existing tokens, supports sorting/search/category/chain filters, and includes protocol details with regression arithmetic, nearest listed comps, and six-step farm plans with USD budgets and time estimates.

The dashboard reports all coefficients, log-space R², median relative OOS error, and mean relative error on the central 90% of holdout errors. Median error is the primary OOS measure because a few extreme misses can dominate mean MAPE; the trimmed MAPE shows typical worst-case scale. The feature set (base features or added log chain count) is selected by holdout median error, after trimming the outer 5% of training residuals and refitting. APY and current fee quotes are absent in the input, so farm plans explicitly use 0% budget yield and fee ceilings rather than fabricated observations.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=/tmp/tr-out node --experimental-strip-types main.ts
```

Input defaults to `/input/snapshot.json` if mounted, otherwise `snapshot.json` here. Override using `--input <file|dir>`. The output includes `board.json`, `data.js`, `dashboard/`, three screenshots and the canonical `dossier.json`. Open the generated `dashboard/index.html` locally.

Regenerate screenshots and exercise dashboard interactions with `node capture.mjs` (requires Playwright and a Node version supporting type stripping). It serves the dashboard and snapshot-derived regression data locally and uses Chromium at `/root/.hermes/tools/chromium-1208/chrome-linux64/chrome`. Captures are 1280×800 JPEGs: the top of the board with filters and methodology, the rank-1 regression detail, and an active category/chain/watchlist filter with results. Run main.ts again afterwards to package them; use `MAKEFUN_OUTPUT_DIR=out node --experimental-strip-types main.ts` to regenerate repository output. Validate with `node verify.mjs out`, which prints coefficients, R², median OOS error, trimmed MAPE, haircut and the top three rows.

## Improve pass

Each successful dashboard build prints log-space R², median OOS relative error, central-90% OOS trimmed MAPE, the haircut, and counts for listed comps, retained and trimmed fit rows, the training/holdout split, and dashboard rows. Snapshot file detection accepts `.json` extensions regardless of case. Verification compares dossier bytes directly with the canonical rebuild, avoiding a text-versus-byte-array assertion.

Run `node main.ts --output /tmp/tr-out` followed by `node verify.mjs` after each generator edit; the verifier defaults to `/tmp/tr-out`. Both improve passes passed verification with 140 rows and 40 watchlist entries: R² was 0.379874, median OOS error 99.21%, and trimmed MAPE 706.66%. These errors indicate substantial prediction uncertainty. Run `node main.ts` to package output at the configured destination (`MAKEFUN_OUTPUT_DIR`, or `/output` by default).
