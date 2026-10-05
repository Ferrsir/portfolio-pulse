import type { Portfolio } from "../shared/types";
import {
  emptyPortfolio,
  portfolioSchema,
  describeIssues,
} from "../shared/schema";
import {
  encryptPortfolio,
  decryptPortfolio,
  type SyncCredentials,
  type VaultEnvelope,
} from "./sync";
/*
 * Where data comes from.
 * - Local mode (`npm run dev`): same-origin /api, holdings in data/portfolio.sqlite.
 * - Hosted mode (GitHub Pages build with VITE_API_BASE): market data from the hosted
 *   API; holdings either in this browser (guest) or in the encrypted synced vault.
 */
export const API_BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");
export const HOSTED = API_BASE !== "";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE + "/api" + path, {
    ...options,
    // A JSON content type on a GET would force a CORS preflight in hosted mode.
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* An HTML error page from a proxy or timeout. */
  }
  if (!response.ok)
    throw new ApiError(
      body?.error ||
        (response.status === 504
          ? "The data service timed out. Try again in a moment."
          : `Request failed (${response.status}).`),
      response.status,
    );
  return body as T;
}
export type Snapshot = { time: string; value: number };
export interface PortfolioStore {
  kind: "server" | "browser" | "sync";
  /** Shown in the UI so the person always knows where their holdings live. */
  label: string;
  load(): Promise<Portfolio>;
  save(next: Portfolio): Promise<Portfolio>;
  snapshots(portfolio: Portfolio, source: string): Promise<Snapshot[]>;
  /** Hosted stores record observed values in this browser; the local server records its own. */
  record?(value: number, portfolio: Portfolio, source: string): void;
  /** Notifies about saves made in another tab of this browser. */
  subscribe?(onChange: (p: Portfolio) => void): () => void;
}
const conflictMessage = "Portfolio changed in another tab. Reload before saving.";
function validated(p: Portfolio) {
  const parsed = portfolioSchema.safeParse(p);
  if (!parsed.success) throw new Error(describeIssues(parsed.error));
  return parsed.data;
}
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Storage blocked: nothing to remove. */
    }
  },
};
/* ---------------- Observed-value snapshots kept in this browser ---------------- */
type SnapshotFile = {
  source: string;
  fingerprint: string;
  points: [string, number][];
};
const MAX_POINTS = 10_000,
  RETENTION_MS = 90 * 86_400_000;
// Holdings or cash edits change what is measured, so they start a new series.
const fingerprint = (p: Portfolio) => JSON.stringify([p.positions, p.cash]);
function browserSnapshots(key: string) {
  const read = (): SnapshotFile | null => {
    try {
      return JSON.parse(storage.get(key) || "null");
    } catch {
      return null;
    }
  };
  return {
    list(p: Portfolio, source: string): Snapshot[] {
      const file = read();
      if (!file || file.source !== source || file.fingerprint !== fingerprint(p))
        return [];
      return file.points.map(([time, value]) => ({ time, value }));
    },
    record(value: number, p: Portfolio, source: string) {
      if (!Number.isFinite(value)) return;
      const print = fingerprint(p),
        previous = read(),
        points =
          previous?.source === source && previous.fingerprint === print
            ? previous.points
            : [],
        minute = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
        cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
      const kept = points.filter(([t]) => t >= cutoff && t !== minute);
      kept.push([minute, value]);
      storage.set(
        key,
        JSON.stringify({
          source,
          fingerprint: print,
          points: kept.slice(-MAX_POINTS),
        }),
      );
    },
    clear: () => storage.remove(key),
  };
}
/* ---------------- Local server (SQLite) ---------------- */
export function serverStore(): PortfolioStore {
  return {
    kind: "server",
    label: "Saved on this computer (data/portfolio.sqlite)",
    load: () => api<Portfolio>("/portfolio"),
    save: (p) =>
      api<Portfolio>("/portfolio", { method: "PUT", body: JSON.stringify(p) }),
    snapshots: () => api<Snapshot[]>("/snapshots"),
  };
}
/* ---------------- Guest: this browser only ---------------- */
const GUEST_KEY = "pulse:portfolio:v1",
  GUEST_SNAPSHOTS = "pulse:snapshots:v1:guest";
export function readGuestPortfolio(): Portfolio {
  try {
    const parsed = portfolioSchema.safeParse(
      JSON.parse(storage.get(GUEST_KEY) || "null"),
    );
    return parsed.success ? parsed.data : structuredClone(emptyPortfolio);
  } catch {
    return structuredClone(emptyPortfolio);
  }
}
export function browserStore(): PortfolioStore {
  const snaps = browserSnapshots(GUEST_SNAPSHOTS);
  return {
    kind: "browser",
    label: "Saved in this browser only",
    load: async () => readGuestPortfolio(),
    save: async (p) => {
      const current = readGuestPortfolio();
      if (current.revision !== p.revision) throw new Error(conflictMessage);
      const next = validated({
        ...p,
        watchlist: [...new Set(p.watchlist)],
        revision: current.revision + 1,
      });
      if (!storage.set(GUEST_KEY, JSON.stringify(next)))
        throw new Error(
          "This browser blocked local storage, so the portfolio could not be saved.",
        );
      return next;
    },
    snapshots: async (p, source) => snaps.list(p, source),
    record: snaps.record,
    subscribe: (onChange) => {
      const listener = (e: StorageEvent) => {
        if (e.key === GUEST_KEY) onChange(readGuestPortfolio());
      };
      window.addEventListener("storage", listener);
      return () => window.removeEventListener("storage", listener);
    },
  };
}
/* ---------------- Signed in: encrypted synced vault ---------------- */
const SESSION_KEY = "pulse:session:v1";
export function savedSession(): SyncCredentials | null {
  try {
    const s = JSON.parse(storage.get(SESSION_KEY) || "null");
    return s && typeof s.username === "string" &&
      /^[0-9a-f]{64}$/.test(s.token) &&
      typeof s.key === "string"
      ? s
      : null;
  } catch {
    return null;
  }
}
export const rememberSession = (c: SyncCredentials) =>
  storage.set(SESSION_KEY, JSON.stringify(c));
export const forgetSession = () => storage.remove(SESSION_KEY);
const vaultHeaders = (c: SyncCredentials) => ({
  Authorization: `Bearer ${c.token}`,
  "X-Pulse-User": c.username,
});
/** Creates the vault for new credentials, seeded with `initial`. */
export async function createVault(c: SyncCredentials, initial: Portfolio) {
  const portfolio = validated({ ...initial, revision: 0 });
  await api<{ etag: string }>("/vault", {
    method: "PUT",
    headers: { ...vaultHeaders(c), "If-None-Match": "*" },
    body: JSON.stringify(await encryptPortfolio(c, portfolio)),
  });
}
export function syncStore(c: SyncCredentials): PortfolioStore {
  const snaps = browserSnapshots(`pulse:snapshots:v1:sync:${c.username}`);
  let etag = "",
    revision = -1;
  return {
    kind: "sync",
    label: `Synced and encrypted · ${c.username}`,
    load: async () => {
      const found = await api<{ etag: string; envelope: VaultEnvelope }>(
        "/vault",
        { headers: vaultHeaders(c), cache: "no-store" },
      );
      const portfolio = await decryptPortfolio(c, found.envelope);
      etag = found.etag;
      revision = portfolio.revision;
      return portfolio;
    },
    save: async (p) => {
      if (!etag || p.revision !== revision) throw new Error(conflictMessage);
      const next = validated({
        ...p,
        watchlist: [...new Set(p.watchlist)],
        revision: p.revision + 1,
      });
      const result = await api<{ etag: string }>("/vault", {
        method: "PUT",
        headers: { ...vaultHeaders(c), "If-Match": etag },
        body: JSON.stringify(await encryptPortfolio(c, next)),
      });
      etag = result.etag;
      revision = next.revision;
      return next;
    },
    snapshots: async (p, source) => snaps.list(p, source),
    record: snaps.record,
  };
}
