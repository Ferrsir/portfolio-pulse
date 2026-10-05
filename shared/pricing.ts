import {
  bsmPrice,
  bsmGreeks,
  americanPrice,
  europeanTree,
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
/** CRR steps for the American comparison. */
export const TREE_STEPS = 300;
/** Names the first invalid field, or returns null when the inputs can be priced. */
export function inputProblem(input: PricingInput): string | null {
  const ok = (x: number) => Number.isFinite(x);
  if (input.type !== "call" && input.type !== "put")
    return "Choose a call or a put.";
  if (!ok(input.spot) || input.spot <= 0) return "Enter a stock price above $0.";
  if (!ok(input.strike) || input.strike <= 0)
    return "Enter a strike price above $0.";
  if (!ok(input.days) || input.days < 0)
    return "Enter the time to expiry as 0 days or more.";
  if (!ok(input.iv) || input.iv < 0)
    return "Enter an implied volatility of 0% or more.";
  if (!ok(input.rate)) return "Enter a risk-free rate.";
  if (!ok(input.dividend)) return "Enter a dividend yield.";
  if (!ok(input.multiplier) || input.multiplier <= 0)
    return "Enter a contract multiplier above 0.";
  return null;
}
export function priceOption(input: PricingInput) {
  const problem = inputProblem(input);
  if (problem) throw new Error(problem);
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
  const T = days / 365;
  // The engine's N(x) = 0.5(1 + erf) loses precision far out of the money and can return
  // about -1e-14; an option premium cannot be negative.
  const premium = Math.max(0, bsmPrice(S, K, T, r, s, q, kind));
  const greeks = T > 0 && s > 0 ? bsmGreeks(S, K, T, r, s, q, kind) : null;
  // Early exercise is measured tree against tree at the same step count, so the CRR
  // discretisation error cancels instead of being reported as an exercise premium.
  let american: number | null = null,
    earlyExercise: number | null = null;
  if (T > 0 && s > 0) {
    try {
      const a = americanPrice(S, K, T, r, s, q, kind, TREE_STEPS),
        e = europeanTree(S, K, T, r, s, q, kind, TREE_STEPS);
      if (Number.isFinite(a) && Number.isFinite(e)) {
        american = a;
        earlyExercise = Math.max(0, a - e);
      }
    } catch {
      /* CRR no-arbitrage condition can fail at very low IV. */
    }
  }
  return {
    premium,
    contractPremium: premium * multiplier,
    american,
    earlyExercise,
    delta: greeks?.delta ?? null,
    gamma: greeks?.gamma ?? null,
    thetaDay: greeks ? greeks.theta / 365 : null,
    vegaPoint: greeks ? greeks.vega / 100 : null,
    rhoPoint: greeks ? greeks.rho / 100 : null,
    intrinsic: Math.max((kind === "call" ? 1 : -1) * (S - K), 0),
  };
}
/** Market premium → European BSM IV (decimal). NaN when no IV in 0.01%–500% fits. */
export function solveIV(premium: number, input: PricingInput) {
  if (inputProblem({ ...input, iv: 0 }) || !Number.isFinite(premium)) return NaN;
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
/** ACT/365 to 16:00 America/New_York, including DST (standard equity expiry convention).
 *  Returns NaN for anything that is not a real calendar date. */
export function daysToExpiry(date: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const base = Date.parse(date + "T16:00:00Z");
  if (
    !Number.isFinite(base) ||
    new Date(base).toISOString().slice(0, 10) !== date
  )
    return NaN;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(base));
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return Math.max(0, (base + (16 - hour) * 3600000 - now) / 86400000);
}
