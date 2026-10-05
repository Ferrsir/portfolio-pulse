import express from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { httpError } from "./errors.js";
/*
 * Synced portfolio storage for the hosted site.
 *
 * The browser derives two keys from username + password (PBKDF2, see src/sync.ts):
 * an auth token it sends here, and an AES-GCM key it never sends. The server stores
 * only the encrypted envelope, at a path derived from username + auth token, so it
 * cannot read holdings and a wrong password simply finds no vault.
 *
 * Abuse limits: the first password to create a username claims it (others get 409),
 * SYNC_ALLOWED_USERS limits which usernames may exist, and SYNC_MAX_ACCOUNTS caps how
 * many usernames can ever be claimed.
 */
export const vaultEnvelope = z.object({
  v: z.literal(1),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  data: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .max(400_000),
});
export type VaultEnvelope = z.infer<typeof vaultEnvelope>;
export type VaultStorage = {
  read(path: string): Promise<{ etag: string; body: string } | null>;
  /** Fails with a 409 if anything already exists at `path`. */
  create(path: string, body: string): Promise<string>;
  /** Fails with a 409 unless the stored ETag still equals `etag`. */
  replace(path: string, body: string, etag: string): Promise<string>;
  remove(path: string, etag?: string): Promise<void>;
  /** Number of stored items whose path starts with `prefix`. */
  count(prefix: string): Promise<number>;
};
const userPattern = /^[a-z0-9._-]{3,40}$/,
  tokenPattern = /^[0-9a-f]{64}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const vaultPath = (user: string, token: string) =>
  `vaults/v1/${sha256(`pulse-vault:v1:${user}:${token}`)}.json`;
const claimPath = (user: string) => `users/v1/${sha256(`pulse-user:v1:${user}`)}.json`;
const listEnv = (name: string) =>
  (process.env[name] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
function account(req: express.Request) {
  const user = String(req.headers["x-pulse-user"] || "")
      .trim()
      .toLowerCase(),
    header = String(req.headers.authorization || ""),
    token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!userPattern.test(user) || !tokenPattern.test(token))
    throw httpError(401, "Sign in again: the sync credentials are missing.");
  const allowed = listEnv("SYNC_ALLOWED_USERS");
  if (allowed.length && !allowed.includes(user))
    throw httpError(403, "Sync is limited to the site owner's accounts.");
  return { user, token, path: vaultPath(user, token) };
}
const etagOf = (req: express.Request, header: string) => {
  const value = String(req.headers[header] || "").trim();
  return value && value.length <= 200 ? value : "";
};
/** Claims the username for this token, or confirms an existing claim by the same token. */
async function claimUsername(storage: VaultStorage, user: string, token: string) {
  const path = claimPath(user),
    proof = sha256(`pulse-claim:v1:${token}`),
    existing = await storage.read(path);
  if (existing) {
    if (JSON.parse(existing.body).proof !== proof)
      throw httpError(409, "That username is already taken. Choose another one.");
    return;
  }
  const max = Number(process.env.SYNC_MAX_ACCOUNTS);
  if (Number.isFinite(max) && max > 0 && (await storage.count("users/v1/")) >= max)
    throw httpError(403, "This site is not accepting new sync accounts.");
  await storage.create(path, JSON.stringify({ proof })).catch(async (e) => {
    // Lost a race with someone claiming the same name at the same moment.
    const now = await storage.read(path);
    if (now && JSON.parse(now.body).proof === proof) return;
    throw e;
  });
}
export function vaultRouter(storage: VaultStorage) {
  const router = express.Router();
  router.use(express.json({ limit: "512kb" }));
  router.get("/", async (req, res, next) => {
    try {
      const found = await storage.read(account(req).path);
      if (!found) {
        res.status(404).json({
          error: "No synced portfolio matches this username and password.",
        });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("ETag", found.etag);
      res.json({ etag: found.etag, envelope: JSON.parse(found.body) });
    } catch (e) {
      next(e);
    }
  });
  router.put("/", async (req, res, next) => {
    try {
      const { user, token, path } = account(req);
      if (!req.is("application/json")) throw httpError(415, "JSON required.");
      const parsed = vaultEnvelope.safeParse(req.body);
      if (!parsed.success)
        throw httpError(400, "The encrypted portfolio was malformed.");
      const body = JSON.stringify(parsed.data),
        ifMatch = etagOf(req, "if-match"),
        create = etagOf(req, "if-none-match") === "*";
      if (!ifMatch && !create)
        throw httpError(428, "Send If-Match (update) or If-None-Match: * (create).");
      if (create) await claimUsername(storage, user, token);
      const etag = create
        ? await storage.create(path, body)
        : await storage.replace(path, body, ifMatch);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("ETag", etag);
      res.json({ etag });
    } catch (e) {
      next(e);
    }
  });
  router.delete("/", async (req, res, next) => {
    try {
      const { user, path } = account(req),
        ifMatch = etagOf(req, "if-match");
      if (!ifMatch) throw httpError(428, "Send If-Match to delete.");
      await storage.remove(path, ifMatch);
      // Free the username; the vault (the proof of the password) is already gone.
      await storage.remove(claimPath(user)).catch(() => {});
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });
  return router;
}
const conflict = () =>
  httpError(
    409,
    "Your synced portfolio changed on another device. Reload to get the latest version, then reapply your edit.",
  );
const exists = () =>
  httpError(409, "An account with this username and password already exists. Sign in instead.");
/** In-memory storage for tests and for local trials without Blob credentials. */
export function memoryVaultStorage(): VaultStorage {
  const items = new Map<string, { etag: string; body: string }>();
  let counter = 0;
  const etag = () => `"m${++counter}"`;
  return {
    read: async (path) => items.get(path) ?? null,
    create: async (path, body) => {
      if (items.has(path)) throw exists();
      const item = { etag: etag(), body };
      items.set(path, item);
      return item.etag;
    },
    replace: async (path, body, expected) => {
      if (items.get(path)?.etag !== expected) throw conflict();
      const item = { etag: etag(), body };
      items.set(path, item);
      return item.etag;
    },
    remove: async (path, expected) => {
      if (expected !== undefined && items.get(path)?.etag !== expected) throw conflict();
      items.delete(path);
    },
    count: async (prefix) => [...items.keys()].filter((k) => k.startsWith(prefix)).length,
  };
}
/** Private Vercel Blob storage (needs BLOB_READ_WRITE_TOKEN, set when a store is connected). */
export async function blobVaultStorage(): Promise<VaultStorage> {
  const blob = await import("@vercel/blob");
  const options = {
    access: "private" as const,
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  };
  const read = async (path: string) => {
    // useCache: false reads origin storage, never a CDN copy up to a minute old.
    const result = await blob.get(path, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { etag: result.blob.etag, body: await new Response(result.stream).text() };
  };
  return {
    read,
    create: async (path, body) => {
      if (await read(path)) throw exists();
      try {
        return (await blob.put(path, body, { ...options, allowOverwrite: false })).etag;
      } catch (e) {
        // Someone created it between our check and the write.
        if (await read(path).catch(() => null)) throw exists();
        throw e;
      }
    },
    replace: async (path, body, etag) => {
      try {
        return (await blob.put(path, body, { ...options, allowOverwrite: true, ifMatch: etag }))
          .etag;
      } catch (e) {
        if (e instanceof blob.BlobPreconditionFailedError) throw conflict();
        throw e;
      }
    },
    remove: async (path, etag) => {
      try {
        await blob.del(path, etag ? { ifMatch: etag } : {});
      } catch (e) {
        if (e instanceof blob.BlobPreconditionFailedError) throw conflict();
        throw e;
      }
    },
    count: async (prefix) => {
      let total = 0,
        cursor: string | undefined;
      do {
        const page = await blob.list({ prefix, cursor, limit: 1000 });
        total += page.blobs.length;
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return total;
    },
  };
}
