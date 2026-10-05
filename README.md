# Pulse

A personal stock portfolio dashboard: delayed quotes and charts, portfolio accounting, market news, option chains with IV, and **your own options-pricer BSM engine**.

**Open it:** https://ferrsir.github.io/portfolio-pulse/. Nothing to install.

## Using the hosted site

- **Guest (default):** your holdings are saved in this browser only. Nothing personal is uploaded.
- **Sync across devices:** *Data & account → Sign in or create a sync account.* Pick a username and a password of 10+ characters. Your browser encrypts the portfolio before upload, and the server stores only ciphertext. **There is no password reset**: if you forget the password, nobody can decrypt the synced copy, so keep a JSON export.
- Market data comes from Yahoo Finance (stocks, charts, news) and Cboe (options) through the Pulse API on Vercel. It is free, delayed and unofficial.

Enter total cost basis for each whole holding, not cost per share. Editing holdings does not change cash; update cash yourself.

## Run locally (optional)

Requires Node.js 24+. From this folder:

```powershell
npm.cmd ci
Copy-Item .env.example .env  # first setup only; do not overwrite an existing .env
npm.cmd run dev
```

Open http://127.0.0.1:5173, or run `./Start-Pulse.ps1`. Local mode keeps holdings in `data/portfolio.sqlite`, separate from the hosted site.

| Mode | Configuration | Behavior |
| --- | --- | --- |
| Free public data | `MARKET_PROVIDER=yahoo` | Yahoo stocks/history/news; Cboe delayed options. No key. Delayed/unofficial, may rate limit or change. |
| Offline preview | `MARKET_PROVIDER=demo` | Simulated prices, fictional news, sample option chains, clearly labeled. |
| Documented API | `MARKET_PROVIDER=massive`, `MASSIVE_API_KEY=…` | Stock snapshots/history/news + option snapshots. Requires separate equities/options entitlements. |

For Massive, `MARKET_DATA_RECENCY=delayed` is the safe default. Polling frequency is not market data freshness. Missing quotes make totals incomplete rather than zero.

## Pages

- **Overview:** value, today's move, unrealized P&L, return since start, price and recorded-value charts, allocation, holdings and watchlist.
- **News:** headlines for your symbols, with filters and search.
- **Options:** expiry/type/strike filters, bid/ask/mid, IV, volume, open interest and delta. Volume/OI does not reveal buying or selling intent.
- **Pricing lab:** your BSM price and Greeks, IV sensitivity, market-implied IV (kept separate from your IV), and an American CRR comparison.
- **Data & account:** where your data lives, sign in/out, JSON export and import with a full preview, theme, and data sources.

Return since start = `(value − starting amount − net contributions) / (starting amount + net contributions)`. It is a simple return, not time-weighted. Recorded portfolio history is never backfilled.

## Deployment

- `.github/workflows/pages.yml` builds the site on every push to `main` and publishes it to GitHub Pages. `VITE_API_BASE` defaults to `https://portfolio-pulse-api.vercel.app` and can be overridden with the repository variable `PULSE_API_BASE`.
- The Vercel project `portfolio-pulse-api` deploys `api/index.ts` on every push (`vercel.json`). Environment: `MARKET_PROVIDER=yahoo`, `ALLOWED_ORIGINS=https://ferrsir.github.io`, and `BLOB_READ_WRITE_TOKEN` from the connected private Blob store. Set `SYNC_ALLOWED_USERS=yourname` to stop others creating sync accounts on your API.

## Privacy and security

`.env`, `data/`, builds and backup files are ignored by Git. The local server binds to loopback, rejects unknown hosts, cross-origin writes and cross-site requests, and keeps Vite from serving `data/` or `.env`. The hosted API never receives holdings in plaintext. No order entry or broker writes exist.

## Model and collaboration

See [model provenance](docs/MODEL.md). `shared/vendor/pricing.js` is copied unchanged from [options-pricer](https://github.com/Ferrsir/options-pricer), commit `68c3636`. Shared agent rules are in [AGENTS.md](AGENTS.md), status in [HANDOFF.md](docs/HANDOFF.md), and bounded prompts in [CLAUDE_PROMPTS.md](docs/CLAUDE_PROMPTS.md).

## Checks

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
```
