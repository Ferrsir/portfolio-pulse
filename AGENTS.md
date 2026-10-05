# Pulse: shared instructions for Codex and Claude

## User objective

Build a personal web app (local, and hosted on GitHub Pages since 2026-10-05 at the user's request) to follow selected stocks, see updating quotes and charts, enter shares and total invested cost, record starting capital and cash, track current portfolio value and returns, read related news, inspect options activity and IV, and compare an option premium with the user's existing BSM model. Push project source to the user's GitHub. Codex is the supervising collaborator; Claude Opus 5.5 is a coding and review partner.

## Current architecture

- React + TypeScript + Vite frontend; Express backend.
- **Local mode:** `npm run dev` serves frontend and API at http://127.0.0.1:5173, bound to loopback. Holdings in SQLite (`node:sqlite`) under ignored `data/`.
- **Hosted mode:** `.github/workflows/pages.yml` builds the static site to https://ferrsir.github.io/portfolio-pulse/ with `VITE_API_BASE` pointing at the Vercel project `portfolio-pulse-api` (https://portfolio-pulse-api.vercel.app, entry `api/index.ts`, config `vercel.json`, auto-deploys on push). Market routes are shared with the local server (`server/routes.ts`).
- **Holdings storage** (`src/backend.ts`): local server (SQLite), hosted guest (this browser's localStorage only), or hosted signed-in sync (`src/sync.ts`, `server/vault.ts`). Sync is end-to-end encrypted: PBKDF2-SHA256 (600k) splits username + password into an auth token and an AES-GCM key; the key never leaves the browser; the server stores only ciphertext in a private Vercel Blob store (`pulse-sync-vault`) with ETag conditional writes. No password reset exists by design.
- `npm run check`, `npm test`, and `npm run build` are required before reporting a code change complete.
- Main files: `src/App.tsx` (shell), `src/pages/*.tsx`, `src/dialogs.tsx`, `src/ui.tsx`, `src/format.ts`, `src/backend.ts`, `src/sync.ts`, `src/styles.css`, `server/index.ts`, `server/routes.ts`, `server/market.ts`, `server/store.ts`, `server/vault.ts`, `api/index.ts`, `shared/schema.ts`, `shared/portfolio.ts`, `shared/pricing.ts`.
- Provider choices: demo; Yahoo stocks/charts/news + Cboe delayed options (the hosted API always uses this); Massive with server-side API key (local only). Alpaca/Tradier adapters are potential follow-up work, not implemented features.

## Pricing source of truth

The user's model is **Ferrsir/options-pricer**, source commit `68c363608c3722a60e08470c78c7db8dd4c28b3f`, file `docs/js/pricing.js`. Its original JavaScript is vendored unchanged in `shared/vendor/pricing.js`. Its BSM and CRR functions are used directly. `shared/pricing.ts` validates inputs, converts days to ACT/365 years, converts theta to per calendar day and vega/rho to per percentage point, and suppresses undefined expiry/zero-volatility Greeks. Keep source provenance in `docs/MODEL.md`.

The adapter also reports early-exercise value as American minus European **on the same CRR tree** (`europeanTree`, also from the vendored file), clamps float-noise negative premiums to 0, reports non-finite tree values as unavailable, names the invalid field in validation errors, and treats non-calendar expiry strings as NaN. Do not silently replace this model with another implementation. Diagnose numerical issues in the adapter first. If the upstream engine needs a change, isolate it, explain it, add an independent numerical check, and record divergence in the model document. A provider-supplied IV may use a different convention from European BSM IV. Show model assumptions and American/European distinctions.

## Portfolio accounting

- Position cost basis is **total dollars paid for the entire position**, not per-share purchase price. Shares may be fractional and must be positive. Long equities only in this version.
- Total value = cash + sum(shares × current quoted price).
- Unrealized P&L = current equity value − total position cost basis.
- Since-start P&L = total value − starting capital − net contributions (deposits minus withdrawals).
- Simple return divides by contributed capital only when that capital is positive. It is not a time-weighted return, tax statement, or transaction ledger.
- Missing prices make aggregate valuation incomplete; never substitute zero or quietly mix simulated data with real data.
- Portfolio edits are manual reconciliation and do not implicitly adjust cash.
- Recorded value history begins here. Do not fabricate historical portfolio returns or backfill today's positions as if they existed earlier. Holdings/cash changes reset snapshots.
- SQLite revision checks reject lost updates from stale browser tabs.

## Market data honesty and security

- Demo quotes, news, and options must be visibly labeled simulated. Sample holdings must be marked sample.
- Yahoo/Cboe are free public endpoints with no availability guarantee. Label delayed/unofficial. Polling frequency is not quote freshness.
- Show source quote timestamps separately from last fetch time. Respect rate limits and bounded pagination; indicate partial chains.
- Options volume/open interest does not prove who bought or sold, trade aggressor, opening/closing status, or institutional intent. Do not label it as confirmed unusual flow.
- Keep credentials, SQLite files, holdings exports, and `.env` out of Git. Never log credentials. No API keys in browser code. The repository may be public: never commit personal data.
- Hosting was explicitly requested by the user on 2026-10-05. Holdings must never reach a server in plaintext: hosted storage is the browser (guest) or the encrypted vault. The hosted API's market routes are public and read-only; `/api/vault` accepts only the site's origins (`ALLOWED_ORIGINS`) and can be limited to named users with `SYNC_ALLOWED_USERS`.
- No order entry, trades, broker writes, paid subscriptions, or automatic financial decisions are in scope.
- Preserve loopback binding, host validation, JSON write requirements, cross-origin write protection, `Sec-Fetch-Site` blocking of cross-site requests, and the Vite dev server's `cors: false` and `fs.deny` (other local pages must not read project files or `data/`).
- Treat a quote price of 0 or below as missing. Refuse expired or unlisted option expiries instead of returning a chain.

## Coordination

Read `docs/HANDOFF.md` and `docs/CLAUDE_PROMPTS.md` before starting. Work on one bounded task at a time. Do not edit the same files concurrently with Codex. For read-only review, report actionable findings with paths, behavior, and a reproduction; do not alter files. For implementation, record changes and verification in `docs/HANDOFF.md`. Never claim the other agent reviewed or tested code unless its output was actually obtained. Use a `codex/` or `claude/` branch for follow-up features and review changes before merging. Do not push personal portfolio data.

## UI

Redesigned 2026-10-05 at the user's request ("fresh clean look + theme toggle"). Light theme by default, dark theme available; the theme follows the OS until the user picks one (remembered in localStorage, applied before first paint in `index.html`). All colours are tokens at the top of `src/styles.css` for both themes; charts read them through `useChartColors()`. Blue accent, green/red only for gains/losses, Geist type with tabular numerals, labels no smaller than 12px, hairline cards without nested cards. Keep the freshness strip (source, last trade time, fetch age, session), dedicated Overview/News/Options/Pricing/Data & account pages, a bottom tab bar under 900px, empty/loading/error states and accessible controls. In the pricing lab, the user's IV and the market-implied IV are separate values: never overwrite one with the other except through the explicit "Use market IV" button. Prefer working charts over invented performance graphics.
