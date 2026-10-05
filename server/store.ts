import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  emptyPortfolio,
  portfolioSchema,
  samplePortfolio,
  symbolSchema,
} from "../shared/schema.js";
import type { Portfolio } from "../shared/types.js";
export { emptyPortfolio, portfolioSchema, samplePortfolio, symbolSchema };
export function createStore(directory = resolve("data")) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, "portfolio.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (time TEXT PRIMARY KEY, value REAL NOT NULL); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
  if (
    !(db.prepare("PRAGMA table_info(snapshots)").all() as { name: string }[])
      .map((c) => c.name)
      .includes("source")
  )
    db.exec("ALTER TABLE snapshots ADD COLUMN source TEXT");
  db.prepare("INSERT OR IGNORE INTO settings (id,value) VALUES (1,?)").run(
    JSON.stringify(emptyPortfolio),
  );
  let snapshotSource: string | null = null;
  return {
    // Call at startup before history is served. Valuations from different market sources
    // (simulated, Yahoo/Cboe, Massive) must never share one chart series.
    setSnapshotSource: (source: string) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = db
          .prepare("SELECT value FROM meta WHERE key='snapshotSource'")
          .get() as { value: string } | undefined;
        if (previous?.value !== source) {
          // Also clears unclassified history recorded before sources were stored.
          db.exec("DELETE FROM snapshots");
          db.prepare(
            "INSERT OR REPLACE INTO meta(key,value) VALUES ('snapshotSource',?)",
          ).run(source);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      snapshotSource = source;
    },
    read: () =>
      JSON.parse(
        (
          db.prepare("SELECT value FROM settings WHERE id=1").get() as {
            value: string;
          }
        ).value,
      ) as Portfolio,
    write: (value: Portfolio) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = JSON.parse(
          (
            db.prepare("SELECT value FROM settings WHERE id=1").get() as {
              value: string;
            }
          ).value,
        ) as Portfolio;
        if (previous.revision !== value.revision)
          throw new Error(
            "Portfolio changed in another tab. Reload before saving.",
          );
        const next = {
          ...value,
          watchlist: [...new Set(value.watchlist)],
          revision: previous.revision + 1,
        };
        db.prepare("UPDATE settings SET value=? WHERE id=1").run(
          JSON.stringify(next),
        );
        // A holdings/cash edit changes the measured portfolio. Do not present the jump as market performance.
        if (
          JSON.stringify(previous.positions) !==
            JSON.stringify(next.positions) ||
          previous.cash !== next.cash
        )
          db.exec("DELETE FROM snapshots");
        db.exec("COMMIT");
        return next;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    record: (value: number) => {
      const time = new Date(
        Math.floor(Date.now() / 60000) * 60000,
      ).toISOString();
      db.prepare(
        "INSERT OR REPLACE INTO snapshots(time,value,source) VALUES (?,?,?)",
      ).run(time, value, snapshotSource);
      db.exec(
        "DELETE FROM snapshots WHERE time < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')",
      );
    },
    history: () =>
      db
        .prepare(
          "SELECT time,value FROM snapshots WHERE source IS ? ORDER BY time LIMIT 130000",
        )
        .all(snapshotSource),
    close: () => db.close(),
  };
}
