import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Portfolio } from "../shared/types";
import { samplePortfolio } from "../shared/schema";
// The hosted API reads these at import time; demo data keeps the test offline.
process.env.MARKET_PROVIDER = "demo";
process.env.VAULT_MEMORY = "1";
delete process.env.BLOB_READ_WRITE_TOKEN;
// Minimal browser storage for the guest store.
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
  },
});
let server: Server, origin: string;
before(async () => {
  const app = (await import("../api/index")).default;
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
test("hosted market routes are public, read-only and CDN-cacheable", async () => {
  let r = await fetch(`${origin}/api/status`, {
    headers: { Origin: "https://example.com" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  r = await fetch(`${origin}/api/quotes?symbols=AAPL,MSFT`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") || "", /s-maxage=15/);
  const body = await r.json();
  assert.equal(body.quotes.length, 2);
  assert.equal(body.quotes[0].source, "Simulated");
  r = await fetch(`${origin}/api/quotes?symbols=AAPL`, { method: "POST" });
  assert.equal(r.status, 405);
  r = await fetch(`${origin}/api/quotes?symbols=`);
  assert.equal(r.status, 400, "an empty symbol list is a client error, not a provider failure");
  r = await fetch(`${origin}/api/nope`);
  assert.equal(r.status, 404);
});
test("vault CORS admits only the site's own origins", async () => {
  const preflight = (from: string) =>
    fetch(`${origin}/api/vault`, {
      method: "OPTIONS",
      headers: {
        Origin: from,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type,x-pulse-if-match,x-pulse-user",
      },
    });
  let r = await preflight("https://ferrsir.github.io");
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://ferrsir.github.io");
  assert.match(r.headers.get("access-control-allow-headers") || "", /X-Pulse-If-Match/);
  assert.match(r.headers.get("access-control-allow-headers") || "", /X-Pulse-Create/);
  r = await preflight("http://localhost:5173");
  assert.equal(r.status, 204);
  r = await preflight("https://evil.example");
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  r = await preflight("https://ferrsir.github.io.evil.example");
  assert.equal(r.status, 403);
});
test("browser and synced stores save, detect stale tabs, and round-trip through the hosted vault", async () => {
  const { browserStore, syncStore, createVault, readGuestPortfolio } =
    await import("../src/backend");
  const { deriveCredentials } = await import("../src/sync");
  // Guest store.
  const guest = browserStore(),
    start = await guest.load();
  assert.equal(start.positions.length, 0);
  const saved = await guest.save({ ...samplePortfolio, revision: start.revision });
  assert.equal(saved.revision, start.revision + 1);
  assert.deepEqual(readGuestPortfolio(), saved);
  await assert.rejects(guest.save({ ...saved, revision: start.revision }), /another tab/);
  await assert.rejects(
    guest.save({ ...saved, positions: [{ symbol: "AAPL", shares: -1, costBasis: 1 }] }),
    /shares/,
  );
  // Snapshots reset when holdings change and when the market source changes.
  guest.record!(1000, saved, "yahoo");
  assert.equal((await guest.snapshots(saved, "yahoo")).length, 1);
  assert.equal((await guest.snapshots(saved, "demo")).length, 0);
  const edited: Portfolio = { ...saved, cash: saved.cash + 1 };
  assert.equal((await guest.snapshots(edited, "yahoo")).length, 0);
  // Synced store against the real hosted app (memory vault), via the browser API client.
  const g = globalThis as { fetch: typeof fetch };
  const realFetch = g.fetch;
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(origin + String(input), init)) as typeof fetch;
  try {
    const me = await deriveCredentials("ferrsir", "correct horse battery", 1000);
    await createVault(me, saved);
    await assert.rejects(createVault(me, saved), /already exists/);
    const deviceA = syncStore(me),
      deviceB = syncStore(me);
    const a = await deviceA.load(),
      b = await deviceB.load();
    assert.equal(a.cash, saved.cash);
    const a2 = await deviceA.save({ ...a, cash: 1 });
    assert.equal(a2.cash, 1);
    await assert.rejects(deviceB.save({ ...b, cash: 2 }), /another device/);
    assert.equal((await deviceB.load()).cash, 1);
    const wrong = await deriveCredentials("ferrsir", "not the password!", 1000);
    await assert.rejects(syncStore(wrong).load(), /No synced portfolio/);
  } finally {
    g.fetch = realFetch;
  }
});
test("mixed-case vault paths get the same origin gate", async () => {
  const r = await fetch(`${origin}/api/Vault`, { headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});
test("symbol lists are canonical and news takes at most 20 symbols", async () => {
  const { parseSymbols, NEWS_SYMBOL_LIMIT } = await import("../server/routes");
  assert.deepEqual(parseSymbols("msft,AAPL,aapl"), ["AAPL", "MSFT"]);
  assert.equal(NEWS_SYMBOL_LIMIT, 20);
  const many = Array.from({ length: 21 }, (_, i) => `S${String.fromCharCode(65 + i)}`).join(",");
  const r = await fetch(`${origin}/api/news?symbols=${many}`);
  assert.equal(r.status, 400);
});
test("browser history never stores readable holdings, and sign-out removes synced history", async () => {
  const { syncStore, rememberSession, forgetSession, browserStore } = await import("../src/backend");
  const guest = browserStore(),
    p = await guest.load();
  guest.record!(1234, { ...p, positions: [{ symbol: "SECRETCO", shares: 7, costBasis: 99 }] }, "x");
  assert.ok(![...memory.values()].some((v) => v.includes("SECRETCO")), "fingerprint leaked holdings");
  const creds = { username: "leaver", token: "a".repeat(64), key: Buffer.alloc(32).toString("base64") };
  rememberSession(creds);
  syncStore(creds).record!(5, p, "x");
  assert.ok(memory.has("pulse:snapshots:v1:sync:leaver"));
  forgetSession();
  assert.ok(!memory.has("pulse:session:v1"));
  assert.ok(!memory.has("pulse:snapshots:v1:sync:leaver"));
});
