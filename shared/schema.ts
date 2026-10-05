import { z } from "zod";
import type { Portfolio } from "./types.js";
// Shared by the local server, the hosted API and the browser (import preview, browser storage).
export const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  // Optional leading ^ for indexes (^GSPC); dots or dashes for share classes (BRK.B).
  .regex(/^\^?[A-Z][A-Z0-9.\-]{0,11}$/);
const amount = z.number().finite().min(0).max(1e12);
export const portfolioSchema = z
  .object({
    initialCapital: amount,
    cash: amount,
    netContributions: z.number().finite().min(-1e12).max(1e12),
    positions: z
      .array(
        z.object({
          symbol: symbolSchema,
          shares: z.number().finite().positive().max(1e9),
          costBasis: amount,
        }),
      )
      .max(100),
    watchlist: z.array(symbolSchema).max(50),
    isSample: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .refine(
    (p) =>
      new Set(p.positions.map((x) => x.symbol)).size === p.positions.length,
    "Combine duplicate positions into one holding.",
  );
export const emptyPortfolio: Portfolio = {
  initialCapital: 0,
  netContributions: 0,
  cash: 0,
  positions: [],
  watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"],
  isSample: false,
  revision: 0,
};
export const samplePortfolio: Portfolio = {
  initialCapital: 25000,
  netContributions: 0,
  cash: 4200,
  positions: [
    { symbol: "AAPL", shares: 35, costBasis: 6650 },
    { symbol: "MSFT", shares: 20, costBasis: 7400 },
    { symbol: "NVDA", shares: 45, costBasis: 5400 },
    { symbol: "TSLA", shares: 5, costBasis: 1350 },
  ],
  watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"],
  isSample: true,
  revision: 0,
};
/** Validation messages a person can act on, e.g. "positions.0.shares: Too small". */
export function describeIssues(error: z.ZodError) {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join(" ");
}
