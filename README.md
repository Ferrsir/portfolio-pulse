# Pulse

A personal, local stock portfolio dashboard with stock movement charts, portfolio accounting, market news, option chains and IV, and **your existing options-pricer BSM engine**.

## Run on Windows

Requires Node.js 24+. From this folder:

```powershell
npm.cmd ci
Copy-Item .env.example .env  # first setup only; do not overwrite an existing .env
npm.cmd run dev
```

Open http://127.0.0.1:5173. Or use `./Start-Pulse.ps1` (provided) to install missing dependencies and launch it.

The app starts with an empty personal portfolio and a watchlist of AAPL, MSFT, NVDA, TSLA, and SPY. Enter your own holdings with **Manage portfolio**, or try explicitly labeled sample holdings. Enter total cost basis for the entire holding, not cost per share. A holding edit does not automatically adjust cash; reconcile your current cash balance separately.

## Market data

Edit `.env` and restart. Keep keys here, never in frontend files.

| Mode | Configuration | Behavior |
| --- | --- | --- |
| Free public data | `MARKET_PROVIDER=yahoo` | Yahoo stocks/history/news; Cboe delayed options. No key. Delayed/unofficial, may rate limit or change. |
| Offline preview | `MARKET_PROVIDER=demo` | Simulated prices, fictional news, sample option chains, clearly labeled. |
| Documented API | `MARKET_PROVIDER=massive`, `MASSIVE_API_KEY=…` | Stock snapshots/history/news + option snapshots. Requires appropriate separate equities/options entitlements. |

For Massive, `MARKET_DATA_RECENCY=delayed` is the safe default. Use `realtime` only after confirming both equities and options entitlements. Polling frequency is not the same as market data freshness. Quotes show provider timestamps. Unavailable quotes make portfolio totals incomplete rather than zero.

As checked on October 5, 2026, Alpaca offers a free IEX equities/indicative options tier and $99/month for full equity/OPRA coverage ([official plans](https://docs.alpaca.markets/us/docs/about-market-data-api)); an Alpaca adapter is not implemented yet. Tradier provides real-time US stocks/options to brokerage account holders, with hourly Greeks ([official coverage](https://docs.tradier.com/docs/market-data)). Massive's options/stock snapshot APIs offer delayed and real-time tiers with separate entitlements ([stocks](https://massive.com/docs/rest/stocks/snapshots/full-market-snapshot), [options](https://massive.com/docs/rest/options/snapshots/option-chain-snapshot)). No subscription is purchased by this project.

## Pages

- **Overview:** current value, cash, invested cost, unrealized P&L, return since start, stock charts, allocation, holdings, and watchlist.
- **Market news:** related headlines, ticker filters, search, and source links.
- **Options activity:** expiry/type filters, bid/ask/mid, IV, volume, OI, delta, quote time and model selection. Volume/OI does not reveal buying/selling intent.
- **Pricing lab:** user's BSM price and Greeks, dividend/rate inputs, IV sensitivity, IV inversion and 300-step American CRR comparison. Premiums are per share and per actual multiplier.
- **Data & settings:** provider instructions, JSON exports/import previews, and sample/reset controls.

Portfolio simple return = `(current value - starting capital - net contributions) / (starting capital + net contributions)` when the denominator is positive. This is not a time-weighted return. There is no transaction ledger or realized-P&L/tax-lot accounting yet. Portfolio value snapshots record once per minute while the app is open; holdings/cash edits reset the series. No historical portfolio performance is fabricated.

## Persistence and privacy

Holdings live in `data/portfolio.sqlite` on your computer, separate from GitHub. `.env`, `data/`, `node_modules/`, builds, and backup files are ignored. The app binds to loopback, rejects unrecognized hosts and cross-origin writes, and sends only requested ticker symbols to data providers. It contains no order-entry or broker-write functionality. Do not expose it publicly without adding authentication and access controls.

## Model and Claude collaboration

See [model provenance](docs/MODEL.md). `shared/vendor/pricing.js` is copied unchanged from the user's [options-pricer](https://github.com/Ferrsir/options-pricer), commit `68c3636`.

The requested `agent.md` points to canonical [AGENTS.md](AGENTS.md). [CLAUDE.md](CLAUDE.md) loads shared instructions for Claude Code. [Handoff](docs/HANDOFF.md) records status and limits, and [Claude prompts](docs/CLAUDE_PROMPTS.md) provides bounded review and implementation tasks.

```powershell
claude --model claude-opus-5-5
```

Paste the first review or next implementation prompt from `docs/CLAUDE_PROMPTS.md`. Codex can invoke the authenticated Claude Code CLI for a bounded review and examine its output; do not allow simultaneous edits to the same files.

## Checks and production mode

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd start
```

The production server uses the same local API and SQLite file. Stop an existing dev server first or use another `PORT`.
