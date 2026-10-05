import express from "express";
import { marketRouter, apiErrorHandler } from "../server/routes.js";
import { vaultRouter, blobVaultStorage, memoryVaultStorage } from "../server/vault.js";
/*
 * Hosted API (Vercel function) for the GitHub Pages site.
 * Market routes are public, read-only and CDN-cached. The /api/vault routes hold the
 * encrypted synced portfolio and accept requests only from the site's own origins.
 */
process.env.MARKET_PROVIDER ||= "yahoo";
const siteOrigins = (process.env.ALLOWED_ORIGINS || "https://ferrsir.github.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const isSiteOrigin = (origin: string) =>
  siteOrigins.includes(origin) ||
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(origin);
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin || "",
    // Express matches routes case-insensitively, so this check must too (/api/Vault).
    vault = req.path.toLowerCase().startsWith("/api/vault");
  if (!vault) {
    // Public market data: no cookies or credentials, so any origin may read it.
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (isSiteOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Pulse-User, X-Pulse-Create, X-Pulse-If-Match",
    );
    res.setHeader("Access-Control-Max-Age", "600");
  } else if (origin) {
    res.status(403).json({ error: "This origin may not use portfolio sync." });
    return;
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!vault && !["GET", "HEAD"].includes(req.method)) {
    res.status(405).json({ error: "Market data is read-only." });
    return;
  }
  if (vault) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/api",
  marketRouter({ cdn: { quotes: 15, history: 60, news: 300, options: 60 } }),
);
let vault: Promise<express.Router> | undefined;
app.use("/api/vault", async (req, res, next) => {
  try {
    // VAULT_MEMORY=1 is for local trials only: it forgets everything on restart.
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VAULT_MEMORY) {
      res.status(503).json({ error: "Portfolio sync is not configured on this server." });
      return;
    }
    vault ??= (async () =>
      vaultRouter(
        process.env.BLOB_READ_WRITE_TOKEN
          ? await blobVaultStorage()
          : memoryVaultStorage(),
      ))();
    (await vault)(req, res, next);
  } catch (e) {
    next(e);
  }
});
app.get("/api", (_req, res) =>
  res.json({ ok: true, service: "Pulse market data and portfolio sync" }),
);
app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
app.use(apiErrorHandler);
export default app;
