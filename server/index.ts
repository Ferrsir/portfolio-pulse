import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { createStore, portfolioSchema } from "./store.js";
import { marketStatus } from "./market.js";
import { marketRouter, apiErrorHandler } from "./routes.js";
import { valuePortfolio } from "../shared/portfolio.js";
import { describeIssues } from "../shared/schema.js";
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
  // Browsers label every request's initiator. Only this app's own pages may call the API or
  // load source files; a page on another port or site may at most navigate here.
  const site = req.headers["sec-fetch-site"];
  if (
    site &&
    site !== "same-origin" &&
    site !== "none" &&
    !(
      req.method === "GET" &&
      req.headers["sec-fetch-mode"] === "navigate" &&
      !req.path.startsWith("/api")
    )
  ) {
    res.status(403).json({ error: "Cross-site requests are blocked." });
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
app.get("/api/portfolio", (_req, res) => res.json(store.read()));
app.put("/api/portfolio", (req, res) => {
  const parsed = portfolioSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: describeIssues(parsed.error) });
    return;
  }
  try {
    res.json(store.write(parsed.data));
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});
app.get("/api/snapshots", (_req, res) => res.json(store.history()));
app.use(
  "/api",
  marketRouter({
    onQuotes: (symbols, data) => {
      const p = store.read(),
        valuation = valuePortfolio(p, data);
      // Record only a complete valuation of every current holding.
      if (
        p.positions.length &&
        valuation.totalValue !== null &&
        p.positions.every((pos) => symbols.includes(pos.symbol))
      )
        store.record(valuation.totalValue);
    },
  }),
);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
app.use(apiErrorHandler);
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
      // Other local pages (e.g. localhost:3000) must not read project files through Vite.
      cors: false,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "data/**",
          ".local/**",
          "**/*.sqlite*",
          "pulse-portfolio*.json",
        ],
      },
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
