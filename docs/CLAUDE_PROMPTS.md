# Prompts for Claude Opus 5.5

Start Claude Code from the project folder, with `claude --model claude-opus-5-5`. Read AGENTS.md and HANDOFF.md first. Do not run multiple agents writing the same files.

## First review (read only)

You are Claude Opus 5.5 reviewing Pulse for Codex, the supervising collaborator. Read AGENTS.md, docs/MODEL.md, and docs/HANDOFF.md. Inspect the existing app for concrete bugs in portfolio accounting, missing/stale quotes, quote freshness and demo labeling, BSM/Greek units, options chain selection and IV, persistence, and local security. Do not edit files or push anything. Do not read .env, data/, user credentials, or portfolio exports. Return at most five actionable findings with severity, path, relevant behavior, and reproduction steps. If none, say so. Distinguish confirmed bugs from future improvements.

## Next implementation: data adapter

Read the handoff and implement an Alpaca data adapter as a separate provider. Use current official API documentation. Support server-side key/secret configuration, explicitly labeled IEX/indicative vs SIP/OPRA entitlement, stock snapshots/history, watchlist news, and option snapshots with IV/Greeks. Never invent missing open interest or volume. Maintain Yahoo/Cboe and demo modes, provider cache/backoff behavior, local-only access, and incomplete portfolio valuation. Validate fixtures, authentication errors, 429s, timestamps, and options pagination. Run npm test, npm run check, and npm run build. Update HANDOFF.md with files changed and evidence. Do not purchase a data plan or place trades.

## Next implementation: richer portfolio accounting

Design and implement a transaction ledger (deposits, withdrawals, buys, sells, dividends, and fees) with a migration from the manual holdings snapshot. Preserve the existing SQLite file and require an explicit migration preview for the user's data. Derive cash and positions without double counting capital. Add realized/unrealized P&L and an accurately labeled return method. Test reconciliation, fractional shares, partial sales, contributions, splits, and missing quotes. Do not fabricate historical returns. Keep the current dashboard design. Submit a reviewable branch and record verification in HANDOFF.md.

## Follow-up after a Claude change

Summarize the concrete behavior you changed, files touched, checks actually run, and remaining limitations. Write the same summary into docs/HANDOFF.md so Codex can review the diff. Do not state that Codex approved or reviewed the change unless the user provides that review.
