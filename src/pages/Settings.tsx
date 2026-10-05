import { useState } from "react";
import {
  Download,
  Upload,
  Cloud,
  Laptop,
  HardDrive,
  ExternalLink,
} from "lucide-react";
import type { MarketStatus, Portfolio } from "../../shared/types";
import { portfolioSchema } from "../../shared/schema";
import { HOSTED, API_BASE, type PortfolioStore } from "../backend";
import type { Update, ThemeChoice } from "../App";
import { Card, Notice, Segmented, Badge } from "../ui";
import { money, number } from "../format";
type Props = {
  portfolio: Portfolio;
  status: MarketStatus | null;
  store: PortfolioStore;
  update: Update;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  onSample: () => Promise<Portfolio>;
  onAccount: () => void;
  onSignOut: () => void;
};
/** Reads a Pulse export; older exports without these fields get safe defaults. */
function parseExport(raw: unknown): Portfolio {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("This file is not a Pulse portfolio export.");
  const value = raw as Record<string, unknown>;
  const parsed = portfolioSchema.safeParse({
    initialCapital: value.initialCapital,
    netContributions: value.netContributions ?? 0,
    cash: value.cash,
    positions: value.positions,
    watchlist: value.watchlist ?? [],
    isSample: value.isSample ?? false,
    revision: 0,
  });
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((i) => i.path.join(".") || "file")),
    ].slice(0, 6);
    throw new Error(
      `This export cannot be imported. Missing or invalid: ${fields.join(", ")}.`,
    );
  }
  return parsed.data;
}
const holdingsText = (p: Portfolio) =>
  p.positions
    .map((x) => `${x.symbol} ${number(x.shares, 6)} · ${money(x.costBasis)}`)
    .join("; ") || "None";
export default function Settings({
  portfolio,
  status,
  store,
  update,
  theme,
  setTheme,
  onSample,
  onAccount,
  onSignOut,
}: Props) {
  const [message, setMessage] = useState(""),
    [imported, setImported] = useState<
      (Portfolio & { previewOf: number }) | null
    >(null),
    [confirmClear, setConfirmClear] = useState(false);
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...portfolio,
              exportedAt: new Date().toISOString(),
              app: "Pulse",
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `pulse-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (file: File) => {
    setMessage("");
    setImported(null);
    try {
      if (file.size > 100_000)
        throw new Error("Choose an export smaller than 100 KB.");
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error("This file is not valid JSON.");
      }
      // Remember which version the preview compared against.
      setImported({ ...parseExport(raw), previewOf: portfolio.revision });
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const rows: [string, string, string][] = imported
    ? [
        [
          "Starting amount",
          money(portfolio.initialCapital),
          money(imported.initialCapital),
        ],
        [
          "Net contributions",
          money(portfolio.netContributions),
          money(imported.netContributions),
        ],
        ["Cash", money(portfolio.cash), money(imported.cash)],
        [
          "Holdings (shares · total cost)",
          holdingsText(portfolio),
          holdingsText(imported),
        ],
        [
          "Total cost basis",
          money(portfolio.positions.reduce((s, p) => s + p.costBasis, 0)),
          money(imported.positions.reduce((s, p) => s + p.costBasis, 0)),
        ],
        [
          "Watchlist",
          portfolio.watchlist.join(", ") || "None",
          imported.watchlist.join(", ") || "None",
        ],
        [
          "Sample data",
          portfolio.isSample ? "Yes" : "No",
          imported.isSample ? "Yes" : "No",
        ],
      ]
    : [];
  const StoreIcon =
    store.kind === "sync"
      ? Cloud
      : store.kind === "browser"
        ? Laptop
        : HardDrive;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data &amp; account</h1>
          <p>
            Where your portfolio lives, backups, appearance and data sources.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <Card title="Where your portfolio is saved">
          <div className="storage-line">
            <StoreIcon size={20} aria-hidden />
            <div>
              <b>{store.label}</b>
              <p>
                {store.kind === "server"
                  ? "Running locally with npm run dev. The hosted site keeps its own, separate data."
                  : store.kind === "browser"
                    ? "Nothing is uploaded. Clearing this browser's site data deletes it, and other devices cannot see it."
                    : "Encrypted in this browser before upload; the server stores only ciphertext. Other devices see it after signing in with the same username and password."}
              </p>
            </div>
          </div>
          {HOSTED && (
            <div className="button-row">
              {store.kind === "sync" ? (
                <button className="button" onClick={onSignOut}>
                  Sign out of this browser
                </button>
              ) : (
                <button className="button primary" onClick={onAccount}>
                  Sign in or create a sync account
                </button>
              )}
            </div>
          )}
          {store.kind === "sync" && (
            <p className="field-note">
              Forgotten passwords cannot be reset, because nobody else holds
              your key. Export a backup below.
            </p>
          )}
        </Card>
        <Card
          title="Backups"
          subtitle="JSON export of holdings, cash, balances and watchlist"
        >
          <div className="button-row">
            <button className="button" onClick={exportData}>
              <Download size={15} aria-hidden /> Export JSON
            </button>
            <label className="button upload">
              <Upload size={15} aria-hidden /> Import JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  if (e.target.files?.[0]) void importFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {imported && (
            <div className="review">
              <b>Replace your portfolio with this export?</b>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Now</th>
                    <th scope="col">After import</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, now, next]) => (
                    <tr key={label} className={now !== next ? "changed" : ""}>
                      <th scope="row">{label}</th>
                      <td>{now}</td>
                      <td>{next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() =>
                    void update((p) => {
                      if (p.revision !== imported.previewOf)
                        throw new Error(
                          "Your portfolio changed after this preview. Choose the file again to compare with the latest version.",
                        );
                      const { previewOf: _, ...next } = imported;
                      return { ...next, revision: p.revision };
                    })
                      .then(() => {
                        setImported(null);
                        setMessage("Backup imported.");
                      })
                      .catch((e: Error) => setMessage(e.message))
                  }
                >
                  Replace portfolio
                </button>
                <button
                  className="button ghost"
                  onClick={() => setImported(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {message && (
            <p className="field-note" role="status">
              {message}
            </p>
          )}
        </Card>
        <Card title="Appearance">
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: "Match system" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <p className="field-note">Saved in this browser.</p>
        </Card>
        <Card
          title="Market data"
          subtitle={
            status
              ? `${status.recency} · quotes refresh every ${number(status.pollMs / 1000, 0)} s while visible`
              : "Connecting…"
          }
        >
          {HOSTED && status?.provider === "demo" ? (
            <p>
              The Pulse API at{" "}
              <code>{API_BASE.replace(/^https?:\/\//, "")}</code> is serving
              simulated data for previews.
            </p>
          ) : HOSTED ? (
            <p>
              Quotes, charts and news come from Yahoo Finance and option chains
              from Cboe, through the Pulse API at{" "}
              <code>{API_BASE.replace(/^https?:\/\//, "")}</code>. Both are
              free, delayed and unofficial: they can lag, rate-limit or change
              without notice.
            </p>
          ) : (
            <>
              <p>
                Current provider: <b>{status?.provider ?? "—"}</b>. Change it in
                the project's <code>.env</code> file and restart.
              </p>
              <ul className="plain-list spaced">
                <li>
                  <code>MARKET_PROVIDER=yahoo</code>: Yahoo stocks, charts and
                  news, Cboe options. No key; delayed and unofficial.
                </li>
                <li>
                  <code>MARKET_PROVIDER=demo</code>: simulated data for offline
                  previews.
                </li>
                <li>
                  <code>MARKET_PROVIDER=massive</code> with{" "}
                  <code>MASSIVE_API_KEY</code>: a documented paid feed; set{" "}
                  <code>MARKET_DATA_RECENCY=realtime</code> only if both stock
                  and option entitlements include it.
                </li>
              </ul>
            </>
          )}
          <p className="field-note">
            Polling often does not make data fresher than the provider allows.
            Pulse never places orders.
          </p>
        </Card>
        <Card title="Sample and reset">
          <div className="button-row">
            <button
              className="button"
              disabled={portfolio.positions.length > 0}
              title={
                portfolio.positions.length
                  ? "Only available for an empty portfolio"
                  : undefined
              }
              onClick={() =>
                void onSample().catch((e: Error) => setMessage(e.message))
              }
            >
              Load sample holdings
            </button>
            <button
              className="button danger"
              onClick={() => setConfirmClear(true)}
            >
              Clear portfolio
            </button>
          </div>
          {portfolio.isSample && (
            <p className="field-note">
              <Badge kind="warn">Sample</Badge> The holdings shown are examples,
              not yours.
            </p>
          )}
          {confirmClear && (
            <div className="review">
              <b>Clear holdings, cash and balances?</b>
              <p>
                Your watchlist stays. Export a backup first if you might want
                them back.
              </p>
              <div className="button-row">
                <button
                  className="button danger"
                  onClick={() =>
                    void update((p) => ({
                      ...p,
                      positions: [],
                      cash: 0,
                      initialCapital: 0,
                      netContributions: 0,
                      isSample: false,
                    }))
                      .then(() => setConfirmClear(false))
                      .catch((e: Error) => setMessage(e.message))
                  }
                >
                  Clear now
                </button>
                <button
                  className="button ghost"
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
        <Card title="Pricing engine">
          <p>
            Black–Scholes–Merton, Greeks, IV solver and CRR tree from{" "}
            <a
              href="https://github.com/Ferrsir/options-pricer"
              target="_blank"
              rel="noreferrer"
            >
              Ferrsir/options-pricer <ExternalLink size={12} aria-hidden />
            </a>{" "}
            at commit <code>68c3636</code>, copied unchanged and run in your
            browser.
          </p>
        </Card>
      </div>
      {store.kind === "browser" && HOSTED && (
        <Notice>
          Tip: sign in to keep the same portfolio on your phone and computer.
        </Notice>
      )}
    </>
  );
}
