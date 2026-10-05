# Codex ↔ Claude handoff

## Requested outcome

Local stock/portfolio dashboard with updating quotes, user-entered positions and starting capital, charts, news, options volume/open interest/IV, and the user's existing BSM model. GitHub delivery. Claude Opus 5.5 works with Codex through Claude Code and shared instructions.

## Implemented foundation

- Dedicated dashboard, news, options activity, pricing lab, and settings pages.
- Long-stock holdings, fractional shares, total cost basis, cash, starting capital, net contributions, unrealized P&L and simple since-start return.
- SQLite persistence with atomic writes and revision conflict protection; JSON backup/import preview.
- Quotes poll every 60 seconds with Yahoo or 15 seconds with demo/Massive while the browser is visible. Options refresh every minute. News caches five minutes.
- Free Yahoo chart/search endpoints for stocks/history/news; Cboe delayed option chain parsing. These are unofficial public endpoints. Direct connectivity succeeded during initial setup.
- Massive quotes/history/news/options adapter for a documented paid feed. Not authenticated or verified against a paid account.
- Original `Ferrsir/options-pricer` JavaScript engine imported unchanged at commit `68c3636`; BSM, Greeks, IV solver and American CRR comparison.
- Model tests, accounting tests, and persistence/revision validation tests.
- Server listens only on loopback; host checks and cross-origin JSON write protection.

## Intentional limits

- Polling with delayed public data is not exchange real-time streaming.
- Current holdings are manual reconciliation, not a transaction ledger. Holdings edits do not move cash. No realized P&L, tax lots, split adjustments, dividend ledger, or time-weighted return.
- Portfolio snapshots collect only while the app is open, once per minute. Holdings/cash edits reset the series.
- Options activity is volume/OI/IV, not confirmed buy/sell flow or a trade-direction classifier.
- Rates/dividend yields in the pricing lab are manually entered assumptions. All contracts are compared with European BSM plus a CRR American reference.
- Public endpoint availability is not guaranteed. Use demo to test offline.
- No Alpaca/Tradier integration yet; no broker writes or hosting.
- Massive's bounded pagination marks chains partial; expiry discovery may be incomplete on very large chains.

## Verification status

All 19 tests pass, including independent BSM values, parity, IV inversion, Greek units, fractional-share accounting, missing prices, SQLite revision conflicts, source-separated snapshots, Massive expiry preservation/pagination, and Cboe timestamp metadata. TypeScript checking and the production build pass. The build reports one bundle-size warning (about 669 KB before gzip); this is an optimization follow-up.

Real Yahoo quote/history/search and Cboe options connectivity succeeded. Browser verification used a separate ignored test database: sample holdings, fractional-share edits, save/reload persistence, related news, expiry/type filtering, contract transfer into the pricing lab, and IV inversion. HTTP checks confirmed cross-origin writes and invalid Host headers are rejected, invalid portfolio input is rejected, and unknown API routes return 404. The user's actual portfolio was preserved.

Authenticated Claude Opus 5.5 performed a read-only review and implemented four bounded corrections with tests. Codex inspected and integrated its changes, fixed expiry-loading display, recency-separated history, retention timestamp format, news symbol deduplication, and missing-volume/IV handling. The original pricing engine's Git blob SHA still matches upstream exactly. See CLAUDE_REVIEW.md.

## Coordination

Claude Code 2.1.289 was installed and authenticated in this session. GitHub CLI authentication was renewed. Repository: https://github.com/Ferrsir/portfolio-pulse (private). Future implementation prompts are in CLAUDE_PROMPTS.md. Keep private holdings, .env, data/, backups and auth tokens out of the repository.

To resume, launch the app with Start-Pulse.ps1 or npm run dev. In this folder, run `claude --model claude-opus-5-5` and paste the next bounded prompt. Codex can continue supervising Claude through the authenticated CLI, reviewing the diff and rerunning checks. Do not edit shared files concurrently.
