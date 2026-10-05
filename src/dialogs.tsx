import { useState } from "react";
import type { FormEvent } from "react";
import { Plus, Trash2, LoaderCircle } from "lucide-react";
import type { Portfolio } from "../shared/types";
import { emptyPortfolio, symbolSchema } from "../shared/schema";
import type { Update } from "./App";
import { Modal, Notice, Segmented } from "./ui";
import { money } from "./format";
import { ApiError, createVault, rememberSession, syncStore } from "./backend";
import {
  credentialProblem,
  deriveCredentials,
  type SyncCredentials,
} from "./sync";
type Row = { symbol: string; shares: string; costBasis: string };
const text = (n: number) => (Number.isFinite(n) ? String(n) : "");
/** Plain-language problems for the editor, checked before anything is sent. */
function editorProblems(
  balances: Record<"initialCapital" | "cash" | "netContributions", string>,
  rows: Row[],
) {
  const problems: string[] = [],
    num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  if (!(num(balances.initialCapital) >= 0))
    problems.push("Enter a starting amount of $0 or more.");
  if (!(num(balances.cash) >= 0))
    problems.push("Enter current cash of $0 or more.");
  if (!Number.isFinite(num(balances.netContributions)))
    problems.push(
      "Enter net contributions (use 0 if none; negative for net withdrawals).",
    );
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const label = `Row ${i + 1}${r.symbol ? ` (${r.symbol.toUpperCase()})` : ""}`;
    const symbol = symbolSchema.safeParse(r.symbol);
    if (!symbol.success)
      problems.push(`${label}: enter a ticker such as AAPL or BRK.B.`);
    else if (seen.has(symbol.data))
      problems.push(
        `${label}: ${symbol.data} appears twice. Combine it into one row.`,
      );
    else seen.add(symbol.data);
    if (!(num(r.shares) > 0))
      problems.push(`${label}: shares must be above 0.`);
    if (!(num(r.costBasis) >= 0))
      problems.push(`${label}: enter the total cost of $0 or more.`);
  });
  if (rows.length > 100) problems.push("Pulse holds up to 100 positions.");
  return problems;
}
export function PortfolioEditor({
  portfolio,
  update,
  onClose,
}: {
  portfolio: Portfolio;
  update: Update;
  onClose: () => void;
}) {
  const [balances, setBalances] = useState({
      initialCapital: text(portfolio.initialCapital),
      cash: text(portfolio.cash),
      netContributions: text(portfolio.netContributions),
    }),
    [rows, setRows] = useState<Row[]>(() =>
      portfolio.positions.map((p) => ({
        symbol: p.symbol,
        shares: text(p.shares),
        costBasis: text(p.costBasis),
      })),
    ),
    [problems, setProblems] = useState<string[]>([]),
    [saving, setSaving] = useState(false),
    // The revision these values were copied from; saving over a newer one would undo it.
    [baseRevision] = useState(portfolio.revision);
  const stale = portfolio.revision !== baseRevision;
  const setRow = (i: number, key: keyof Row, value: string) =>
    setRows((list) =>
      list.map((r, j) =>
        i === j
          ? { ...r, [key]: key === "symbol" ? value.toUpperCase() : value }
          : r,
      ),
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = editorProblems(balances, rows);
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    const positions = rows.map((r) => ({
      symbol: r.symbol.trim().toUpperCase(),
      shares: Number(r.shares),
      costBasis: Number(r.costBasis),
    }));
    try {
      await update((current) => {
        if (current.revision !== baseRevision)
          throw new Error(
            "Your portfolio changed while this editor was open. Close it and reopen to edit the latest version.",
          );
        return {
          ...current,
          initialCapital: Number(balances.initialCapital),
          cash: Number(balances.cash),
          netContributions: Number(balances.netContributions),
          positions,
          isSample: false,
          // New holdings join the watchlist (up to its 50-symbol limit).
          watchlist: [
            ...new Set([
              ...current.watchlist,
              ...positions.map((p) => p.symbol),
            ]),
          ].slice(0, 50),
        };
      });
      onClose();
    } catch (err) {
      setProblems([(err as Error).message]);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Edit portfolio"
      description="Enter what you hold now. Cost basis is the total you paid for each whole position, including fees."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <fieldset className="form-grid three">
            <legend className="sr-only">Balances</legend>
            {(
              [
                ["initialCapital", "Starting amount", "What you began with"],
                [
                  "netContributions",
                  "Net contributions",
                  "Deposits − withdrawals since",
                ],
                ["cash", "Current cash", "Uninvested balance today"],
              ] as const
            ).map(([key, label, hint]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <span className="with-unit">
                  <i>$</i>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={balances[key]}
                    onChange={(e) =>
                      setBalances((b) => ({ ...b, [key]: e.target.value }))
                    }
                  />
                </span>
                <small>{hint}</small>
              </label>
            ))}
          </fieldset>
          <p className="field-note">
            Editing holdings never moves cash; update cash yourself.
          </p>
          <div className="editor-head">
            <h3>Holdings</h3>
            <button
              type="button"
              className="button ghost small"
              onClick={() =>
                setRows((r) => [
                  ...r,
                  { symbol: "", shares: "", costBasis: "" },
                ])
              }
            >
              <Plus size={14} aria-hidden /> Add holding
            </button>
          </div>
          {rows.length ? (
            <div className="holding-rows">
              <div className="holding-row head" aria-hidden>
                <span>Symbol</span>
                <span>Shares</span>
                <span>Total cost basis</span>
                <span />
              </div>
              {rows.map((r, i) => {
                const per = Number(r.costBasis) / Number(r.shares);
                return (
                  <div className="holding-row" key={i}>
                    <input
                      aria-label={`Row ${i + 1} symbol`}
                      value={r.symbol}
                      placeholder="AAPL"
                      maxLength={12}
                      autoCapitalize="characters"
                      onChange={(e) => setRow(i, "symbol", e.target.value)}
                    />
                    <input
                      aria-label={`Row ${i + 1} shares`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={r.shares}
                      placeholder="10"
                      onChange={(e) => setRow(i, "shares", e.target.value)}
                    />
                    <span className="cost-cell">
                      <span className="with-unit">
                        <i>$</i>
                        <input
                          aria-label={`Row ${i + 1} total cost basis`}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={r.costBasis}
                          placeholder="1500"
                          onChange={(e) =>
                            setRow(i, "costBasis", e.target.value)
                          }
                        />
                      </span>
                      <small>
                        {Number.isFinite(per) && Number(r.shares) > 0
                          ? `${money(per)} per share`
                          : " "}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove row ${i + 1}`}
                      onClick={() =>
                        setRows((list) => list.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="field-note">
              No holdings. Add one, or save with cash only.
            </p>
          )}
          {stale && (
            <Notice kind="warn">
              Your portfolio changed elsewhere while this editor was open. Close
              and reopen it to edit the latest version; saving now is blocked.
            </Notice>
          )}
          {problems.length > 0 && (
            <Notice kind="error">
              <ul className="plain-list">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={saving || stale}
          >
            {saving ? "Saving…" : "Save portfolio"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function SymbolDialog({
  portfolio,
  update,
  onClose,
}: {
  portfolio: Portfolio;
  update: Update;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <Modal
      title="Watch a symbol"
      description="Follow a US stock or ETF by its ticker."
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = symbolSchema.safeParse(symbol);
          if (!parsed.success)
            return setError("Enter a ticker such as AMZN or BRK.B.");
          if (portfolio.watchlist.includes(parsed.data))
            return setError(`${parsed.data} is already on your watchlist.`);
          if (portfolio.watchlist.length >= 50)
            return setError(
              "The watchlist holds up to 50 symbols. Remove one first.",
            );
          setSaving(true);
          try {
            await update((p) => ({
              ...p,
              watchlist: [...new Set([...p.watchlist, parsed.data])],
            }));
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="modal-body">
          <label className="field">
            <span>Ticker</span>
            <input
              autoFocus
              placeholder="AMZN"
              value={symbol}
              maxLength={12}
              autoCapitalize="characters"
              onChange={(e) => {
                setError("");
                setSymbol(e.target.value.toUpperCase());
              }}
            />
          </label>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            Add to watchlist
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function AccountDialog({
  guest,
  onDone,
  onClose,
}: {
  /** This browser's guest portfolio, offered as the starting point for a new account. */
  guest: Portfolio | null;
  onDone: (c: SyncCredentials) => void;
  onClose: () => void;
}) {
  const hasGuestData = Boolean(
    guest && (guest.positions.length || guest.cash || guest.initialCapital),
  );
  const [mode, setMode] = useState<"signin" | "create">("signin"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [copyGuest, setCopyGuest] = useState(hasGuestData),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const problem = credentialProblem(username, password);
    if (problem) return setError(problem);
    if (mode === "create" && password !== confirm)
      return setError("The two passwords do not match.");
    try {
      setBusy("Securing your keys…");
      const credentials = await deriveCredentials(username, password);
      if (mode === "create") {
        setBusy("Creating your encrypted portfolio…");
        await createVault(
          credentials,
          copyGuest && guest ? guest : emptyPortfolio,
        );
      } else {
        setBusy("Opening your portfolio…");
        await syncStore(credentials).load();
      }
      rememberSession(credentials);
      onDone(credentials);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "No synced portfolio matches that username and password. Check both, or create an account."
          : (err as Error).message,
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <Modal
      title={mode === "signin" ? "Sign in to sync" : "Create a sync account"}
      description="Your holdings are encrypted in this browser before upload. The server never sees your password or your portfolio."
      // Closing mid-request would hide whether the account was created.
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <Segmented
            label="Account"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError("");
            }}
            options={[
              { value: "signin", label: "Sign in" },
              { value: "create", label: "Create account" },
            ]}
          />
          <label className="field">
            <span>Username</span>
            <input
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={
                mode === "create" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "create" && (
              <small>At least 10 characters. A passphrase works well.</small>
            )}
          </label>
          {mode === "create" && (
            <>
              <label className="field">
                <span>Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              {hasGuestData && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={copyGuest}
                    onChange={(e) => setCopyGuest(e.target.checked)}
                  />
                  <span>
                    Start with this browser's portfolio (
                    {guest!.positions.length} holdings, {money(guest!.cash, 0)}{" "}
                    cash)
                  </span>
                </label>
              )}
              <Notice kind="warn">
                There is no password reset. If you forget it, nobody can decrypt
                the synced copy, so keep a JSON export as a backup.
              </Notice>
            </>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="button" onClick={onClose} disabled={Boolean(busy)}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={Boolean(busy)}
          >
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" aria-hidden /> {busy}
              </>
            ) : mode === "signin" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
