import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { createStore, portfolioSchema, symbolSchema } from "./store";
import { quotes, history, news, options, marketStatus } from "./market";
import { valuePortfolio } from "../shared/portfolio";
const app = express(),
  store = createStore(
    process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : undefined,
  ),
  port = Number(process.env.PORT) || 5173;
if (!["demo", "yahoo", "massive"].includes(marketStatus().provider))
  throw new Error("MARKET_PROVIDER must be demo, yahoo, or massive.");
// Before any route can read history: drop snapshots recorded under another source.
store.setSnapshotSource(`${marketStatus().provider}:${marketStatus().recency}`);
app.disable("x-powered-by");
app.use((req, res, next) => {
  // Reject DNS rebinding and cross-origin writes to the local portfolio server.
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(req.headers.host || "")) {
    res.status(403).json({ error: "Local access only." });
    return;
  }
  if (req.path.startsWith("/api") && !["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.origin;
    if (
      origin &&
      !new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(
        origin,
      )
    ) {
      res.status(403).json({ error: "Cross-origin writes are blocked." });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "JSON required." });
      return;
    }
  }
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "100kb" }));
app.get("/api/status", (_req, res) => res.json(marketStatus()));
app.get("/api/portfolio", (_req, res) => res.json(store.read()));
app.put("/api/portfolio", (req, res) => {
  const parsed = portfolioSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues.map((i) => i.message).join(" ") });
    return;
  }
  try {
    res.json(store.write(parsed.data));
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});
function parseSymbols(value: unknown) {
  const list = String(value || "")
    .split(",")
    .filter(Boolean);
  if (!list.length || list.length > 150)
    throw new Error("Request between 1 and 150 symbols.");
  return [...new Set(list.map((s) => symbolSchema.parse(s)))];
}
app.get("/api/quotes", async (req, res, next) => {
  try {
    const symbols = parseSymbols(req.query.symbols),
      data = await quotes(symbols),
      p = store.read(),
      valuation = valuePortfolio(p, data);
    if (
      p.positions.length &&
      valuation.totalValue !== null &&
      p.positions.every((pos) => symbols.includes(pos.symbol))
    )
      store.record(valuation.totalValue);
    res.json({ quotes: data, fetchedAt: new Date().toISOString() });
  } catch (e) {
    next(e);
  }
});
app.get("/api/history/:symbol", async (req, res, next) => {
  try {
    res.json(
      await history(
        symbolSchema.parse(req.params.symbol),
        String(req.query.range || "1M"),
      ),
    );
  } catch (e) {
    next(e);
  }
});
app.get("/api/snapshots", (_req, res) => res.json(store.history()));
app.get("/api/news", async (req, res, next) => {
  try {
    res.json(await news(parseSymbols(req.query.symbols)));
  } catch (e) {
    next(e);
  }
});
app.get("/api/options/:symbol", async (req, res, next) => {
  try {
    const expiry = req.query.expiry ? String(req.query.expiry) : undefined;
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      res.status(400).json({ error: "Invalid expiry." });
      return;
    }
    res.json(await options(symbolSchema.parse(req.params.symbol), expiry));
  } catch (e) {
    next(e);
  }
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) =>
    res.status(err.name === "ZodError" ? 400 : 502).json({
      error:
        err.name === "ZodError"
          ? "Invalid request parameters."
          : err.message.includes("Market") ||
              err.message.includes("Yahoo") ||
              err.message.includes("MASSIVE")
            ? err.message
            : "Data request failed. Check your connection or provider configuration.",
    }),
);
const production = process.argv.includes("--production");
let vite:
  Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
if (production) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  vite = await createServer({
    // Per-app HMR port so parallel instances (e.g. 5173 and 5174) do not collide; loopback only.
    server: {
      middlewareMode: true,
      ws: { host: "127.0.0.1", port: port + 1000 },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `Pulse is ready at http://127.0.0.1:${port} (${marketStatus().provider})`,
  ),
);
async function shutdown() {
  server.close();
  await vite?.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
