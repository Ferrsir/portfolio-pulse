import {
  bsmPrice,
  bsmGreeks,
  americanPrice,
  impliedVol,
} from "./vendor/pricing.js";
export type PricingInput = {
  spot: number;
  strike: number;
  days: number;
  rate: number;
  iv: number;
  dividend: number;
  type: "call" | "put";
  multiplier: number;
};
export function priceOption(input: PricingInput) {
  const {
    spot: S,
    strike: K,
    days,
    rate: r,
    iv: s,
    dividend: q,
    type: kind,
    multiplier,
  } = input;
  if (
    ![S, K, days, r, s, q, multiplier].every(Number.isFinite) ||
    S <= 0 ||
    K <= 0 ||
    days < 0 ||
    s < 0 ||
    multiplier <= 0 ||
    !["call", "put"].includes(kind)
  )
    throw new Error(
      "Enter valid, finite pricing inputs. Spot and strike must be positive.",
    );
  const T = days / 365;
  const premium = bsmPrice(S, K, T, r, s, q, kind);
  const greeks = T > 0 && s > 0 ? bsmGreeks(S, K, T, r, s, q, kind) : null;
  let american: number | null = null;
  if (T > 0 && s > 0) {
    try {
      american = americanPrice(S, K, T, r, s, q, kind, 300);
    } catch {
      /* CRR no-arbitrage condition can fail at very low IV. */
    }
  }
  return {
    premium,
    contractPremium: premium * multiplier,
    american,
    delta: greeks?.delta ?? null,
    gamma: greeks?.gamma ?? null,
    thetaDay: greeks ? greeks.theta / 365 : null,
    vegaPoint: greeks ? greeks.vega / 100 : null,
    rhoPoint: greeks ? greeks.rho / 100 : null,
    intrinsic: Math.max((kind === "call" ? 1 : -1) * (S - K), 0),
  };
}
export function solveIV(premium: number, input: PricingInput) {
  return impliedVol(
    premium,
    input.spot,
    input.strike,
    input.days / 365,
    input.rate,
    input.dividend,
    input.type,
  );
}
/** ACT/365 to 16:00 America/New_York, including DST (standard equity expiry convention). */
export function daysToExpiry(date: string, now = Date.now()) {
  const base = Date.parse(date + "T16:00:00Z");
  if (!Number.isFinite(base)) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(base));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return Math.max(0, (base + (16 - hour) * 3600000 - now) / 86400000);
}
