import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  deriveCredentials,
  encryptPortfolio,
  decryptPortfolio,
  credentialProblem,
  PBKDF2_ITERATIONS,
} from "../src/sync";
import { vaultRouter, memoryVaultStorage, vaultPath } from "../server/vault";
import { apiErrorHandler } from "../server/routes";
import { samplePortfolio } from "../shared/schema";
const fast = 1000; // PBKDF2 iterations for speed; one test uses the production count.
test("credentials are deterministic, normalized, and split into token + key", async () => {
  const a = await deriveCredentials("  Ferrsir ", "correct horse battery", fast),
    b = await deriveCredentials("ferrsir", "correct horse battery", fast),
    c = await deriveCredentials("ferrsir", "correct horse batterY", fast);
  assert.equal(a.username, "ferrsir");
  assert.deepEqual(a, b);
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from(a.key, "base64").length, 32);
  assert.notEqual(a.token, c.token);
  assert.notEqual(a.key, c.key);
  // The token and the encryption key must be independent halves.
  assert.notEqual(a.token, Buffer.from(a.key, "base64").toString("hex"));
});
test("production iteration count derives in reasonable time", async () => {
  const start = Date.now();
  await deriveCredentials("ferrsir", "correct horse battery", PBKDF2_ITERATIONS);
  assert.ok(Date.now() - start < 5000);
});
test("credential validation explains what to fix", () => {
  assert.match(credentialProblem("ab", "long enough pw")!, /3–40/);
  assert.match(credentialProblem("ferrsir", "short")!, /10 characters/);
  assert.equal(credentialProblem("ferr.sir_1", "long enough pw"), null);
});
test("encryption round-trips and rejects a wrong password, tampering, and another account", async () => {
  const me = await deriveCredentials("ferrsir", "correct horse battery", fast),
    wrong = await deriveCredentials("ferrsir", "wrong horse battery", fast),
    envelope = await encryptPortfolio(me, samplePortfolio);
  assert.equal(envelope.v, 1);
  assert.ok(!JSON.stringify(envelope).includes("AAPL"), "plaintext leaked");
  assert.deepEqual(await decryptPortfolio(me, envelope), samplePortfolio);
  await assert.rejects(decryptPortfolio(wrong, envelope), /could not be decrypted/);
  const bytes = Buffer.from(envelope.data, "base64");
  bytes[5] ^= 1;
  await assert.rejects(
    decryptPortfolio(me, { ...envelope, data: bytes.toString("base64") }),
    /could not be decrypted/,
  );
  // Same key bytes under another username: the authenticated context must not match.
  await assert.rejects(
    decryptPortfolio({ ...me, username: "someone" }, envelope),
    /could not be decrypted/,
  );
});
let server: Server, base: string;
before(async () => {
  const app = express();
  app.use("/api/vault", vaultRouter(memoryVaultStorage()));
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/vault`;
});
after(() => server.close());
test("vault: create, read, conditional update, conflicts, and errors", async () => {
  const me = await deriveCredentials("ferrsir", "correct horse battery", fast),
    other = await deriveCredentials("ferrsir", "another long password", fast),
    auth = (c: typeof me, extra: Record<string, string> = {}) => ({
      Authorization: `Bearer ${c.token}`,
      "X-Pulse-User": c.username,
      "Content-Type": "application/json",
      ...extra,
    }),
    body = JSON.stringify(await encryptPortfolio(me, samplePortfolio));
  let r = await fetch(base, { headers: auth(me) });
  assert.equal(r.status, 404);
  r = await fetch(base, { method: "PUT", headers: auth(me), body });
  assert.equal(r.status, 428, "a write without a precondition is refused");
  r = await fetch(base, {
    method: "PUT",
    headers: auth(me, { "If-None-Match": "*" }),
    body,
  });
  assert.equal(r.status, 200);
  const created = (await r.json()).etag as string;
  r = await fetch(base, {
    method: "PUT",
    headers: auth(me, { "If-None-Match": "*" }),
    body,
  });
  assert.equal(r.status, 409, "creating twice is a conflict");
  r = await fetch(base, { headers: auth(me) });
  assert.equal(r.status, 200);
  const read = await r.json();
  assert.equal(read.etag, created);
  assert.deepEqual(await decryptPortfolio(me, read.envelope), samplePortfolio);
  // A wrong password lands on a different (empty) path rather than an error that confirms the user exists.
  assert.equal((await fetch(base, { headers: auth(other) })).status, 404);
  r = await fetch(base, {
    method: "PUT",
    headers: auth(me, { "If-Match": created }),
    body,
  });
  assert.equal(r.status, 200);
  const updated = (await r.json()).etag as string;
  assert.notEqual(updated, created);
  r = await fetch(base, {
    method: "PUT",
    headers: auth(me, { "If-Match": created }),
    body,
  });
  assert.equal(r.status, 409, "a stale ETag (other device saved) is rejected");
  assert.match((await r.json()).error, /another device/);
  r = await fetch(base, {
    method: "PUT",
    headers: auth(me, { "If-Match": updated }),
    body: JSON.stringify({ v: 1, iv: "x", data: "plain text" }),
  });
  assert.equal(r.status, 400);
  r = await fetch(base, { headers: { "X-Pulse-User": "ferrsir" } });
  assert.equal(r.status, 401);
  r = await fetch(base, {
    method: "PUT",
    headers: { ...auth(me, { "If-Match": updated }), "Content-Type": "text/plain" },
    body,
  });
  assert.equal(r.status, 415);
  r = await fetch(base, {
    method: "PUT",
    headers: auth(me, { "If-Match": updated }),
    body: "{not json",
  });
  assert.equal(r.status, 400);
  assert.doesNotMatch((await r.json()).error, /Unexpected|position/);
  process.env.SYNC_ALLOWED_USERS = "owner";
  try {
    assert.equal((await fetch(base, { headers: auth(me) })).status, 403);
  } finally {
    delete process.env.SYNC_ALLOWED_USERS;
  }
  r = await fetch(base, { method: "DELETE", headers: auth(me, { "If-Match": updated }) });
  assert.equal(r.status, 204);
  assert.equal((await fetch(base, { headers: auth(me) })).status, 404);
});
test("vault paths depend on both username and token", () => {
  const t = "a".repeat(64);
  assert.notEqual(vaultPath("a", t), vaultPath("b", t));
  assert.notEqual(vaultPath("a", t), vaultPath("a", "b".repeat(64)));
  assert.match(vaultPath("a", t), /^vaults\/v1\/[0-9a-f]{64}\.json$/);
});
