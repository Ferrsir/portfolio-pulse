import { test } from "node:test";
import assert from "node:assert/strict";
import { priceOption, solveIV, daysToExpiry } from "../shared/pricing";
const input = {
  spot: 100,
  strike: 100,
  days: 365,
  rate: 0.05,
  iv: 0.2,
  dividend: 0,
  type: "call" as const,
  multiplier: 100,
};
test("User model matches the independent BSM benchmark", () => {
  const p = priceOption(input);
  assert.ok(Math.abs(p.premium - 10.450583572185565) < 1e-10);
  assert.ok(Math.abs(p.contractPremium - 1045.0583572185565) < 1e-8);
  assert.ok(Math.abs(p.vegaPoint! - 0.3752403469169379) < 1e-10);
});
test("Dividend-adjusted put-call parity", () => {
  const p = { ...input, dividend: 0.025 },
    c = priceOption(p).premium,
    put = priceOption({ ...p, type: "put" }).premium;
  assert.ok(
    Math.abs(c - put - (100 * Math.exp(-0.025) - 100 * Math.exp(-0.05))) <
      1e-10,
  );
});
test("American put exceeds European value and covers intrinsic", () => {
  const p = priceOption({ ...input, spot: 80, type: "put" });
  assert.ok(p.american! >= p.premium);
  assert.ok(p.american! >= 20);
});
test("Expiry and zero IV produce a finite price without undefined Greeks", () => {
  const expired = priceOption({ ...input, spot: 120, days: 0 });
  assert.equal(expired.premium, 20);
  assert.equal(expired.delta, null);
  const zero = priceOption({ ...input, iv: 0 });
  assert.ok(Number.isFinite(zero.premium));
  assert.equal(zero.gamma, null);
});
test("IV inversion recovers model volatility and rejects impossible prices", () => {
  assert.ok(Math.abs(solveIV(priceOption(input).premium, input) - 0.2) < 1e-10);
  assert.ok(Number.isNaN(solveIV(101, input)));
});
test("Greeks agree with a central finite difference", () => {
  const epsilon = 0.001,
    up = priceOption({ ...input, spot: 100 + epsilon }).premium,
    down = priceOption({ ...input, spot: 100 - epsilon }).premium;
  assert.ok(
    Math.abs((up - down) / (2 * epsilon) - priceOption(input).delta!) < 1e-8,
  );
});
test("Time to equity expiry uses New York DST and ACT/365", () => {
  assert.equal(
    daysToExpiry("2026-07-17", Date.parse("2026-07-16T20:00:00Z")),
    1,
  );
  assert.equal(
    daysToExpiry("2026-12-18", Date.parse("2026-12-17T21:00:00Z")),
    1,
  );
});
test("Invalid numerical inputs are rejected", () => {
  assert.throws(() => priceOption({ ...input, spot: 0 }));
  assert.throws(() => priceOption({ ...input, iv: NaN }));
  assert.throws(() => priceOption({ ...input, days: -1 }));
});
