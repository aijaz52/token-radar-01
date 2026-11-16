# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aijaz5209/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/aijaz5209/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A snapshot-based radar for pre-token protocols, ranked by implied value using TVL, growth, maturity, category, and chain breadth. The dark radar console provides sortable rankings, search and category filters, inspectable value components, and complete farm plans. Generate the output with Node 22, then open `out/dashboard/index.html` to explore the local data without a server.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```
