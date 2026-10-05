# Pulse: shared instructions for Codex and Claude

## User objective

Build a personal **local web app** to follow selected stocks, see updating quotes and charts, enter shares and total invested cost, record starting capital and cash, track current portfolio value and returns, read related news, inspect options activity and IV, and compare an option premium with the user's existing BSM model. Push project source to the user's GitHub. Codex is the supervising collaborator; Claude Opus 5.5 is a coding and review partner.

## Current architecture

- React + TypeScript + Vite frontend; Express backend, bound to 127.0.0.1.
- SQLite via Node 24's built-in `node:sqlite`. Local personal data is in ignored `data/`.
- One process serves frontend and API. `npm run dev` starts at http://127.0.0.1:5173.
- `npm run check`, `npm test`, and `npm run build` are required before reporting a code change complete.
- Main files: `src/App.tsx`, `src/styles.css`, `server/index.ts`, `server/market.ts`, `server/store.ts`, `shared/portfolio.ts`, `shared/pricing.ts`.
- Provider choices: demo; Yahoo stocks/charts/news + Cboe delayed options; Massive with server-side API key. Alpaca/Tradier adapters are potential follow-up work, not implemented features.

## Pricing source of truth

The user's model is **Ferrsir/options-pricer**, source commit `68c363608c3722a60e08470c78c7db8dd4c28b3f`, file `docs/js/pricing.js`. Its original JavaScript is vendored unchanged in `shared/vendor/pricing.js`. Its BSM and CRR functions are used directly. `shared/pricing.ts` validates inputs, converts days to ACT/365 years, converts theta to per calendar day and vega/rho to per percentage point, and suppresses undefined expiry/zero-volatility Greeks. Keep source provenance in `docs/MODEL.md`.

Do not silently replace this model with another implementation. Diagnose numerical issues in the adapter first. If the upstream engine needs a change, isolate it, explain it, add an independent numerical check, and record divergence in the model document. A provider-supplied IV may use a different convention from European BSM IV. Show model assumptions and American/European distinctions.

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
- Keep credentials, SQLite files, holdings exports, and `.env` out of Git. Never log credentials. No API keys in browser code.
- The app must remain local unless the user explicitly changes that requirement. Hosting requires authentication and storage/access design first.
- No order entry, trades, broker writes, paid subscriptions, or automatic financial decisions are in scope.
- Preserve loopback binding, host validation, JSON write requirements, and cross-origin write protection.

## Coordination

Read `docs/HANDOFF.md` and `docs/CLAUDE_PROMPTS.md` before starting. Work on one bounded task at a time. Do not edit the same files concurrently with Codex. For read-only review, report actionable findings with paths, behavior, and a reproduction; do not alter files. For implementation, record changes and verification in `docs/HANDOFF.md`. Never claim the other agent reviewed or tested code unless its output was actually obtained. Use a `codex/` or `claude/` branch for follow-up features and review changes before merging. Do not push personal portfolio data.

## UI

Keep the dark Pulse design, lime accent, restrained typography, responsive layouts, explicit data status, and dedicated Overview/News/Options/Pricing/Settings pages. Empty/loading/error states and accessible controls matter. Prefer working charts over invented performance graphics. Do not add technical implementation details to ordinary user flows unless they help a meaningful choice.
