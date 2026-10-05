# Claude follow-up: review fixes

Author: Claude Opus 5.5 (Claude Code). Codex inspected and integrated the changes, then reran verification before GitHub delivery.

## Changes

1. **Massive expiry choices persist across filtered requests** (`server/market.ts`, `src/App.tsx`)
   - New bounded per-underlying memory `expiryChoices`: at most 200 underlyings (oldest evicted), 400 expiries each, 6-hour TTL, past dates dropped. The merge runs after the existing 30 s response cache, so it adds no provider requests. Pagination is still capped at four pages, and `truncated` still discloses partial chains.
   - Client: `OptionsPage` merges `chain.expiries` into a dropdown list scoped to the selected underlying and resets it when the underlying changes.
2. **Snapshot history is separated by market source** (`server/store.ts`, `server/index.ts`)
   - `snapshots` gains a nullable `source` column, added via `ALTER TABLE` when missing. A new `meta` table stores `snapshotSource`.
   - `store.setSnapshotSource(provider)` runs in one transaction. If the stored source differs, or none has been established yet, it deletes all snapshots, including legacy unclassified rows. The portfolio row (holdings, cash, revision) is untouched.
   - `server/index.ts` calls it synchronously right after provider validation, before any route is registered or the server listens.
   - `record()` tags rows with the source. `history()` returns only rows matching the current source, as a second safeguard.
3. **Cboe timestamps** (`server/market.ts`, `shared/types.ts`, `src/App.tsx`)
   - Option `asOf` is now `null` for Cboe, which provides no per-contract bid/ask quote time. The table's Quote Time column shows "—".
   - New optional `OptionChain.snapshotGeneratedAt`. `cboeGeneratedAt()` reads the top-level `timestamp` (`YYYY-MM-DD HH:MM:SS`, UTC) and normalizes it to ISO UTC. It returns null for anything else. `data.last_trade_time` (Eastern local) is not used.
   - Source label: `Cboe · 15-minute delayed`. The chain header shows "· snapshot generated h:mm TZ".
4. **Near-the-money IV** (`shared/types.ts`, `src/App.tsx`)
   - New pure helper `nearMoneyIV(contracts, spot)`. It returns null if spot is missing, non-finite or ≤ 0. Otherwise it finds the strike nearest spot among contracts with valid IV (finite, > 0), and averages the valid call and put IV at that strike. A tie between strikes picks the lower strike. No values are filled in.
   - The stat note reads "Needs an underlying price" when spot is missing. Otherwise it reads "Avg. call/put IV · nearest strike".
5. **HMR port** (`server/index.ts`): Vite middleware uses `server.ws = { host: "127.0.0.1", port: PORT + 1000 }`. Vite 8 uses `server.ws`; `server.hmr.port` is deprecated. The explicit host keeps the separate HMR socket on loopback (left unset, Vite binds to all interfaces). Express loopback binding and the host/origin/JSON checks are unchanged.

## Tests added

- `tests/market.test.ts` (new; `fetch` is mocked, no network calls):
  - An unfiltered Massive request discovers three expiries. A filtered request for one expiry then sends `expiration_date` and still returns all three. A different underlying does not inherit them.
  - Massive pagination stops at four requests and returns `truncated: true`.
  - A mocked Cboe payload (`timestamp: "2026-10-05 18:41:52"`, `last_trade_time` present) gives `snapshotGeneratedAt === "2026-10-05T18:41:52.000Z"`, every contract `asOf === null`, and the 15-minute-delayed label.
  - `nearMoneyIV`: null/undefined/0 spot → null; call/put average at the nearest strike; one valid side used alone; all-null IV → null.
- `tests/store.test.ts`: in a temporary directory, an unclassified legacy snapshot is cleared when the first source is set. The same source survives a restart. Switching `demo` → `yahoo` leaves zero rows (checked by a raw SQLite count). Portfolio holdings, cash and revision equal the saved value.

## Checks run

- `npx prettier --write` on all changed files.
- `npm test`: 19/19 pass.
- `npm run check`: passes.
- `npm run build`: passes. The existing >500 kB chunk-size warning is unchanged.

## Limitations

- Expiry memory is in-process. A server restart forgets it until an unfiltered request rediscovers expiries. With a truncated unfiltered Massive request (more than four pages), discovered expiries may still be incomplete; the partial-chain alert remains.
- Codex extended the snapshot source key to include the configured recency and corrected the 90-day comparison to ISO UTC strings.
- Claude used fixtures without live provider requests. Codex verified real Yahoo/Cboe connectivity and the browser workflow separately.

## Codex integration follow-up

- Hide old contract rows immediately when selecting another underlying or expiry; retain discovered expiry choices while loading.
- Do not show zero aggregate volume for a missing chain or missing volume fields. Treat nonpositive Cboe IV placeholders as unavailable; manual zero-IV pricing remains supported.
- Deduplicate news symbol chips, cap auto-added watchlist entries at 50, and accept the full valid union of 100 holdings plus 50 watchlist symbols in the quote/news API.
- Format numeric input values to readable precision and show cleared invalid values as blank fields with validation.
- Confirmed the original pricing engine's Git blob SHA exactly matches `382631abc0b152bc0eebb0038b1c6dc11ce06aaa`.
