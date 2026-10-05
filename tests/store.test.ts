import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore, portfolioSchema } from "../server/store";
test("SQLite persists portfolio data and rejects stale writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "pulse-test-"));
  let store = createStore(directory);
  try {
    const p = store.read(),
      saved = store.write({ ...p, cash: 123.45 });
    assert.equal(saved.revision, 1);
    assert.throws(() => store.write(p), /another tab/);
    store.close();
    store = createStore(directory);
    assert.equal(store.read().cash, 123.45);
    store.record(123.45);
    assert.equal(store.history().length, 1);
    store.write({ ...store.read(), cash: 200 });
    assert.equal(store.history().length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("Snapshots never mix market sources and source changes keep the portfolio", () => {
  const directory = mkdtempSync(join(tmpdir(), "pulse-test-"));
  let store = createStore(directory);
  const countAll = () => {
    const db = new DatabaseSync(join(directory, "portfolio.sqlite"));
    try {
      return (
        db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number }
      ).n;
    } finally {
      db.close();
    }
  };
  try {
    // Legacy, unclassified history recorded before a source was established.
    store.record(1);
    const saved = store.write({
      ...store.read(),
      cash: 50,
      positions: [{ symbol: "AAPL", shares: 1.5, costBasis: 300 }],
    });
    store.record(500);
    assert.equal(countAll(), 1);
    store.close();
    store = createStore(directory);
    store.setSnapshotSource("demo");
    assert.equal(countAll(), 0);
    store.record(510);
    assert.deepEqual(
      store.history().map((r: any) => r.value),
      [510],
    );
    // Same source on restart keeps the series.
    store.close();
    store = createStore(directory);
    store.setSnapshotSource("demo");
    assert.equal(store.history().length, 1);
    // Different source: no old snapshots remain.
    store.close();
    store = createStore(directory);
    store.setSnapshotSource("yahoo");
    assert.equal(store.history().length, 0);
    assert.equal(countAll(), 0);
    store.record(520);
    assert.deepEqual(
      store.history().map((r: any) => r.value),
      [520],
    );
    assert.deepEqual(store.read(), saved);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("Portfolio validation rejects negative holdings, duplicates, and invalid tickers", () => {
  const base = {
    initialCapital: 0,
    cash: 0,
    netContributions: 0,
    positions: [],
    watchlist: [],
    isSample: false,
    revision: 0,
  };
  assert.equal(portfolioSchema.safeParse({ ...base, cash: -1 }).success, false);
  const pos = { symbol: "AAPL", shares: 1, costBasis: 10 };
  assert.equal(
    portfolioSchema.safeParse({ ...base, positions: [pos, pos] }).success,
    false,
  );
  assert.equal(
    portfolioSchema.safeParse({ ...base, positions: [{ ...pos, shares: -1 }] })
      .success,
    false,
  );
  assert.equal(
    portfolioSchema.safeParse({ ...base, watchlist: ["../../secret"] }).success,
    false,
  );
});
