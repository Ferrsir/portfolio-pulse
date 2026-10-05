import express from "express";
import type { Quote } from "../shared/types.js";
import { symbolSchema } from "../shared/schema.js";
import { quotes, history, news, options, marketStatus } from "./market.js";
import { httpError } from "./errors.js";
export { httpError };
export function parseSymbols(value: unknown) {
  const list = String(value || "")
    .split(",")
    .filter(Boolean);
  if (!list.length || list.length > 150)
    throw httpError(400, "Request between 1 and 150 symbols.");
  return [...new Set(list.map((s) => symbolSchema.parse(s)))];
}
export const chartRanges = ["1D", "1W", "1M", "3M", "1Y"];
/** A real YYYY-MM-DD date (rejects 2026-13-99 and 2026-02-30). */
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
type Options = {
  /** Called after quotes are fetched (the local server records portfolio snapshots here). */
  onQuotes?: (symbols: string[], data: Quote[]) => void;
  /** Shared CDN cache lifetimes in seconds (hosted API only). Omit to keep responses uncached. */
  cdn?: { quotes: number; history: number; news: number; options: number };
};
/** Read-only market data routes, shared by the local server and the hosted API. */
export function marketRouter({ onQuotes, cdn }: Options = {}) {
  const router = express.Router();
  const cache = (res: express.Response, seconds: number | undefined) => {
    if (seconds)
      res.setHeader(
        "Cache-Control",
        `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
      );
  };
  router.get("/status", (_req, res) => res.json(marketStatus()));
  router.get("/quotes", async (req, res, next) => {
    try {
      const symbols = parseSymbols(req.query.symbols),
        data = await quotes(symbols);
      onQuotes?.(symbols, data);
      cache(res, cdn?.quotes);
      // Report when the provider was actually asked (server caches reuse data for up to a minute).
      const fetchedAt =
        data
          .map((q) => q.fetchedAt)
          .filter((t): t is string => Boolean(t))
          .sort()[0] ?? new Date().toISOString();
      res.json({ quotes: data, fetchedAt });
    } catch (e) {
      next(e);
    }
  });
  router.get("/history/:symbol", async (req, res, next) => {
    try {
      const range = String(req.query.range || "1M");
      if (!chartRanges.includes(range))
        throw httpError(400, `Chart range must be one of ${chartRanges.join(", ")}.`);
      const bars = await history(symbolSchema.parse(req.params.symbol), range);
      cache(res, cdn?.history);
      res.json(bars);
    } catch (e) {
      next(e);
    }
  });
  router.get("/news", async (req, res, next) => {
    try {
      const items = await news(parseSymbols(req.query.symbols));
      cache(res, cdn?.news);
      res.json(items);
    } catch (e) {
      next(e);
    }
  });
  router.get("/options/:symbol", async (req, res, next) => {
    try {
      const expiry = req.query.expiry ? String(req.query.expiry) : undefined;
      if (expiry && !isCalendarDate(expiry)) {
        res.status(400).json({ error: "Invalid expiry." });
        return;
      }
      const chain = await options(symbolSchema.parse(req.params.symbol), expiry);
      cache(res, cdn?.options);
      res.json(chain);
    } catch (e) {
      next(e);
    }
  });
  return router;
}
/** Turns thrown errors into short JSON messages without leaking internals. */
export function apiErrorHandler(
  err: Error & { status?: number },
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  // body-parser errors (malformed JSON, oversized bodies) carry a `type`; their messages are internal.
  const type = (err as { type?: string }).type;
  if (type?.startsWith("entity.")) {
    res
      .status(type === "entity.too.large" ? 413 : 400)
      .json({
        error:
          type === "entity.too.large"
            ? "Request body is too large."
            : "Request body was not valid JSON.",
      });
    return;
  }
  if (err.status && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(err.name === "ZodError" ? 400 : 502).json({
    error:
      err.name === "ZodError"
        ? "Invalid request parameters."
        : err.message.includes("Market") ||
            err.message.includes("Yahoo") ||
            err.message.includes("MASSIVE")
          ? err.message
          : "Data request failed. Check your connection or provider configuration.",
  });
}
