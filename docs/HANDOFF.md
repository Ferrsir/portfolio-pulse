# Codex ↔ Claude handoff

## Requested outcome

Stock/portfolio dashboard with updating quotes, user-entered positions and starting capital, charts, news, options volume/open interest/IV, and the user's existing BSM model. On 2026-10-05 the user also asked for: a cleaner redesign with a theme toggle, agent-based bug testing, verification, and hosting as a GitHub website with holdings synced behind a login.

## Implemented

- Pages: Overview, News, Options, Pricing lab, Data & account. Light/dark themes (OS default, remembered override); freshness strip; bottom tab bar on phones.
- Long-stock holdings, fractional shares, total cost basis, cash, starting capital, net contributions, unrealized P&L and simple since-start return.
- **Local mode** (`npm run dev`): SQLite with atomic writes and revision conflicts, loopback only.
- **Hosted mode**: GitHub Pages site + Vercel API `portfolio-pulse-api` (market data via Yahoo/Cboe; `/api/vault` for sync). Guest holdings stay in the browser; signed-in holdings are encrypted in the browser (PBKDF2 → auth token + AES-GCM key) and stored as ciphertext in a private Vercel Blob store with ETag conditional writes.
- Original `Ferrsir/options-pricer` engine unchanged (blob `382631a`); adapter changes are listed in MODEL.md.

## 2026-10-05 session (Claude Opus 5.5, branch `claude/hosted-redesign`)

Three read-only QA agents covered accounting/persistence/security, market data/options/IV, and pricing math. Each finding was reproduced before it was fixed; non-reproduced suspicions are listed in their reports.

Fixed: Vite dev server let other local pages read project files (now `cors: false`, `fs.deny` for `data/`, `.env*`, SQLite; cross-site requests blocked by `Sec-Fetch-Site`); a cross-site GET could record snapshots; zero prices were valued as real; bad requests returned 502 instead of 4xx; chart range read prototype keys; quick successive saves lost an edit (saves are now serialized); import preview hid net contributions and watchlist (now validated with the shared schema and shows every field); early-exercise value measured tree error; negative float-noise premiums; Infinity tree values; invalid expiries treated as expired; pricing lab used the previous stock's spot or a $100 placeholder; market IV overwrote the user's IV; expired or unlisted expiries returned live-looking chains; Massive could default to an expired expiry; BRK.B worked for quotes or options but not both; implausible IVs (>300%) shown as real; quote "updated" time ignored server caching; Yahoo news empty from cloud hosts (RSS fallback).

Second QA round on the new code (one agent driving the UI in a browser against a local copy of the hosted build, one code reviewer). Fixed: retrying a save after a conflict could overwrite the other device's edit (the editor and import now refuse to save over a newer revision; Save is disabled with an explanation); Blob reads now bypass the CDN cache; usernames are claimed by their first password and `SYNC_MAX_ACCOUNTS` (set to 5 on Vercel) caps sign-ups; sign-out removes the account's local history and snapshot fingerprints are hashed; a store switch cannot record the previous store's values; symbol lists are canonical, news is limited to 20 symbols and provider calls run at most six at a time; `/api/Vault` gets the vault origin gate; `VOD.L`-style exchange suffixes stay as typed; import preview shows each holding's shares and cost; the pricing lab clears a market premium when the stock changes, rejects negative premiums, and no longer copies a provider IV into your IV when a contract is linked; dialogs return focus to their opener; a new editor row is focused and labelled on phones; light-theme muted text meets 4.5:1; charts have accessible names. Browser-tool snapshots that had been committed to the branch were removed from its history before publishing, and `.playwright-mcp/` is ignored.

Verification: `npm test` (44 tests, incl. encryption round trip/tamper/cross-account, vault conflicts and CORS), `npm run check`, `npm run build` (no chunk warning). Deployed API smoke-tested from outside; UI checked in light/dark at desktop and 375px.

Production verification (2026-10-05, against https://portfolio-pulse-api.vercel.app): live quotes with provider fetch time, news (10 headlines), 98-contract Cboe chain with underlying, expired expiry 404, BRK.B quote and options, vault preflight allowed for the site and refused for other origins (also `/api/Vault`), and an encrypted vault create → read/decrypt → update → stale-update 409 → fresh read → delete on the real Blob store. This found one production-only bug: Vercel's edge answered a successful create with 304 because the request used `If-None-Match: *` and Express sent an ETag; the app now uses `X-Pulse-Create` / `X-Pulse-If-Match` headers and the API sends no automatic ETags.

Two self-test vaults from the failed runs remain in the Blob store (`users/v1/` and `vaults/v1/` objects created about 21:18–21:20 UTC on 2026-10-05, undecryptable ciphertext). `SYNC_MAX_ACCOUNTS` was raised to 7 to compensate; they can be deleted in the Vercel Blob browser.

## Intentional limits

- Polling delayed public data is not real-time streaming. Holidays are not detected in the "regular session" label.
- Holdings are manual reconciliation, not a ledger: no realized P&L, tax lots, splits, dividends or time-weighted return. Edits do not move cash.
- Portfolio value history records only while the app is open (per browser in hosted mode) and resets on holdings/cash edits.
- Options activity is volume/OI/IV, not buy/sell flow. SPX AM/PM roots and adjusted roots are not separated. Massive (unverified, no key) can still hide an expiry when its 4-page cap truncates the unfiltered chain.
- Sync has no password reset by design; keep JSON exports. Anyone can create a vault unless `SYNC_ALLOWED_USERS` is set on the Vercel project.
- No Alpaca/Tradier integration, broker writes or orders.

## Coordination

Repository: https://github.com/Ferrsir/portfolio-pulse. Do not edit shared files concurrently. Keep private holdings, `.env`, `data/`, backups and tokens out of the repository (it may be public). The Vercel project redeploys on every push; the Pages workflow deploys on pushes to `main`.
