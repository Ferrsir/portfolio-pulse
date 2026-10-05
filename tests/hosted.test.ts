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
        "Access-Control-Request-Headers": "authorization,content-type,if-match,x-pulse-user",
      },
    });
  let r = await preflight("https://ferrsir.github.io");
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://ferrsir.github.io");
  assert.match(r.headers.get("access-control-allow-headers") || "", /If-Match/);
  assert.match(r.headers.get("access-control-expose-headers") || "", /ETag/);
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
