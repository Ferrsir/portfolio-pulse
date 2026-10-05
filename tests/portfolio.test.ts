import { test } from "node:test";
import assert from "node:assert/strict";
import { valuePortfolio } from "../shared/portfolio";
import type { Portfolio, Quote } from "../shared/types";
const p: Portfolio = {
  initialCapital: 1000,
  netContributions: 200,
  cash: 200,
  positions: [{ symbol: "AAPL", shares: 10, costBasis: 1000 }],
  watchlist: ["AAPL"],
  isSample: false,
  revision: 0,
};
const q: Quote = {
  symbol: "AAPL",
  name: "Apple",
  price: 110,
  previousClose: 108,
  change: 2,
  changePercent: (2 / 108) * 100,
  asOf: null,
  source: "Test",
};
test("Portfolio keeps position P&L separate from return on contributed capital", () => {
  const v = valuePortfolio(p, [q]);
  assert.equal(v.totalValue, 1300);
  assert.equal(v.unrealized, 100);
  assert.equal(v.sinceStart, 100);
  assert.equal(v.dayChange, 20);
  assert.ok(Math.abs(v.returnPercent! - (100 / 1200) * 100) < 1e-10);
});
test("Missing prices never silently value holdings at zero", () => {
  const v = valuePortfolio(p, []);
  assert.equal(v.totalValue, null);
  assert.equal(v.sinceStart, null);
  assert.equal(v.unrealized, null);
  assert.equal(v.dayChange, null);
});
test("Fractional shares and cash-only portfolios work", () => {
  assert.equal(
    valuePortfolio(
      { ...p, positions: [{ symbol: "AAPL", shares: 0.25, costBasis: 20 }] },
      [q],
    ).totalValue,
    227.5,
  );
  assert.equal(
    valuePortfolio({ ...p, positions: [], cash: 123.45 }, []).totalValue,
    123.45,
  );
});
test("Zero contributed capital has no fabricated percentage return", () => {
  assert.equal(
    valuePortfolio({ ...p, initialCapital: 0, netContributions: 0 }, [q])
      .returnPercent,
    null,
  );
});
