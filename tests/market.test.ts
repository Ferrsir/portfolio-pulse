import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { options, quotes, cboeGeneratedAt } from "../server/market";
import { nearMoneyIV } from "../shared/types";
import type { OptionContract } from "../shared/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MARKET_PROVIDER;
  delete process.env.MASSIVE_API_KEY;
});
// Mock fetch: no network calls. Records requested URLs.
function mockFetch(respond: (url: URL) => unknown) {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    return new Response(JSON.stringify(respond(url)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}
const massiveRow = (expiry: string, type: "call" | "put", strike: number) => ({
  details: {
    ticker: `O:QQQX${expiry.replaceAll("-", "").slice(2)}${type[0].toUpperCase()}${strike}`,
    contract_type: type,
    strike_price: strike,
    expiration_date: expiry,
    shares_per_contract: 100,
  },
  last_quote: { bid: 1, ask: 1.2, last_updated: 1_700_000_000_000_000_000 },
  implied_volatility: 0.3,
  day: { volume: 10 },
  open_interest: 50,
  greeks: { delta: 0.5 },
});

test("Massive filtered expiry request keeps previously discovered expiries", async () => {
  process.env.MARKET_PROVIDER = "massive";
  process.env.MASSIVE_API_KEY = "test-only";
  const all = ["2099-01-16", "2099-02-20", "2099-03-20"];
  const calls = mockFetch((url) => {
    const only = url.searchParams.get("expiration_date");
    return {
      results: (only ? [only] : all).flatMap((e) => [
        massiveRow(e, "call", 100),
        massiveRow(e, "put", 100),
      ]),
    };
  });
  const first = await options("EXPTEST");
  assert.deepEqual(first.expiries, all);
  assert.ok(first.contracts.every((c) => c.expiry === "2099-01-16"));
  const filtered = await options("EXPTEST", "2099-02-20");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("expiration_date"), "2099-02-20");
  assert.deepEqual(filtered.expiries, all);
  assert.ok(filtered.contracts.every((c) => c.expiry === "2099-02-20"));
  // Choices are scoped to the underlying.
  const other = await options("OTHERX", "2099-02-20");
  assert.deepEqual(other.expiries, ["2099-02-20"]);
});

test("Massive pagination stays bounded and discloses a partial chain", async () => {
  process.env.MARKET_PROVIDER = "massive";
  process.env.MASSIVE_API_KEY = "test-only";
  const calls = mockFetch(() => ({
    results: [massiveRow("2099-01-16", "call", 100)],
    next_url: "https://api.massive.com/v3/snapshot/options/PAGEX?cursor=abc",
  }));
  const chain = await options("PAGEX");
  assert.equal(calls.length, 4);
  assert.equal(chain.truncated, true);
});

test("Cboe chain exposes snapshot generation time, not quote timestamps", async () => {
  process.env.MARKET_PROVIDER = "yahoo";
  mockFetch(() => ({
    timestamp: "2026-10-05 18:41:52",
    data: {
      last_trade_time: "2026-10-05T14:26:50",
      options: [
        {
          option: "CBTX991218C00100000",
          bid: 1.1,
          ask: 1.3,
          iv: 0.31,
          volume: 12,
          open_interest: 40,
          delta: 0.52,
        },
        {
          option: "CBTX991218P00100000",
          bid: 0.9,
          ask: 1.0,
          iv: 0.33,
          volume: 8,
          open_interest: 30,
          delta: -0.48,
        },
      ],
    },
  }));
  const chain = await options("CBTX");
  assert.equal(chain.source, "Cboe · 15-minute delayed");
  assert.equal(chain.snapshotGeneratedAt, "2026-10-05T18:41:52.000Z");
  assert.equal(chain.contracts.length, 2);
  assert.ok(chain.contracts.every((c) => c.asOf === null));
  assert.equal(cboeGeneratedAt("not a time"), null);
  assert.equal(cboeGeneratedAt(undefined), null);
});

const contract = (
  type: "call" | "put",
  strike: number,
  iv: number | null,
): OptionContract => ({
  ticker: `${type}${strike}`,
  type,
  strike,
  expiry: "2099-01-16",
  bid: null,
  ask: null,
  iv,
  volume: null,
  openInterest: null,
  delta: null,
  multiplier: 100,
  asOf: null,
});

test("Near-the-money IV requires a spot price and averages call/put at nearest strike", () => {
  const chain = [
    contract("call", 0.5, 0.9),
    contract("call", 100, 0.3),
    contract("put", 100, 0.34),
    contract("call", 105, 0.28),
    contract("put", 105, null),
  ];
  assert.equal(nearMoneyIV(chain, null), null);
  assert.equal(nearMoneyIV(chain, undefined), null);
  assert.equal(nearMoneyIV(chain, 0), null);
  assert.ok(Math.abs(nearMoneyIV(chain, 101)! - 0.32) < 1e-12);
  // Nearest strike with only one valid IV uses that value; no invented put IV.
  assert.equal(nearMoneyIV(chain, 104.9), 0.28);
  assert.equal(nearMoneyIV([contract("call", 100, null)], 100), null);
});
test("Massive zeroed bars after the overnight reset are a missing price, not $0", async () => {
  process.env.MARKET_PROVIDER = "massive";
  process.env.MASSIVE_API_KEY = "test-only";
  mockFetch(() => ({
    tickers: [
      { ticker: "ZERO", min: { c: 0 }, day: { c: 0 }, prevDay: { c: 227.5 } },
      { ticker: "LATE", min: { c: 0 }, day: { c: 101.5 }, prevDay: { c: 100 } },
    ],
  }));
  const [zero, late] = await quotes(["ZERO", "LATE"]);
  assert.equal(zero.price, null);
  assert.equal(zero.change, null);
  assert.equal(late.price, 101.5, "falls through a zero minute bar to the day bar");
});
