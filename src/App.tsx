import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  LayoutDashboard,
  Newspaper,
  Layers3,
  Calculator,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Monitor,
  Cloud,
  HardDrive,
  Laptop,
  RefreshCw,
} from "lucide-react";
import type {
  Portfolio,
  Quote,
  MarketStatus,
  OptionContract,
} from "../shared/types";
import { valuePortfolio } from "../shared/portfolio";
import { samplePortfolio } from "../shared/schema";
import {
  api,
  ApiError,
  HOSTED,
  serverStore,
  browserStore,
  syncStore,
  savedSession,
  forgetSession,
  type PortfolioStore,
} from "./backend";
import type { SyncCredentials } from "./sync";
import { ThemeContext, Notice, Empty, type ResolvedTheme } from "./ui";
import { ago, marketClock, regularSession } from "./format";
import Overview from "./pages/Overview";
import { PortfolioEditor, SymbolDialog, AccountDialog } from "./dialogs";
const News = lazy(() => import("./pages/News")),
  Options = lazy(() => import("./pages/Options")),
  Pricing = lazy(() => import("./pages/Pricing")),
  Settings = lazy(() => import("./pages/Settings"));
const navigation = [
  { id: "dashboard", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { id: "news", label: "News", short: "News", icon: Newspaper },
  { id: "options", label: "Options", short: "Options", icon: Layers3 },
  { id: "bsm", label: "Pricing lab", short: "Pricing", icon: Calculator },
  { id: "settings", label: "Data & account", short: "Settings", icon: SettingsIcon },
] as const;
export type Page = (typeof navigation)[number]["id"];
const pageFromHash = (): Page => {
  const id = location.hash.slice(1);
  return navigation.some((n) => n.id === id) ? (id as Page) : "dashboard";
};
export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "pulse:theme";
const readTheme = (): ThemeChoice => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
};
const systemTheme = (): ResolvedTheme =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
function initialStore(): PortfolioStore {
  if (!HOSTED) return serverStore();
  const session = savedSession();
  return session ? syncStore(session) : browserStore();
}
export type Update = (change: (p: Portfolio) => Portfolio) => Promise<Portfolio>;
export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash),
    [themeChoice, setThemeChoice] = useState<ThemeChoice>(readTheme),
    [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
      readTheme() === "system" ? systemTheme() : (readTheme() as ResolvedTheme),
    ),
    [store, setStore] = useState<PortfolioStore>(initialStore),
    [portfolio, setPortfolio] = useState<Portfolio | null>(null),
    [loadError, setLoadError] = useState(""),
    [status, setStatus] = useState<MarketStatus | null>(null),
    [statusError, setStatusError] = useState(""),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [fetchedAt, setFetchedAt] = useState(""),
    [quoteError, setQuoteError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState<"" | "editor" | "symbol" | "account">(""),
    [selected, setSelected] = useState(""),
    [contract, setContract] = useState<OptionContract | null>(null),
    [snapshotTick, setSnapshotTick] = useState(0);
  const latest = useRef<Portfolio | null>(null),
    queue = useRef<Promise<unknown>>(Promise.resolve());
  /* ---------- theme ---------- */
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      apply = () =>
        setResolvedTheme(themeChoice === "system" ? systemTheme() : themeChoice);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeChoice]);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolvedTheme === "dark" ? "#0c0e12" : "#f5f6f8");
  }, [resolvedTheme]);
  const chooseTheme = (t: ThemeChoice) => {
    setThemeChoice(t);
    try {
      if (t === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch {
      /* The choice still applies for this visit. */
    }
  };
  /* ---------- routing ---------- */
  useEffect(() => {
    const change = () => {
      setPage(pageFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const navigate = (p: Page) => {
    if (location.hash.slice(1) === p) return;
    location.hash = p;
  };
  /* ---------- portfolio ---------- */
  useEffect(() => {
    let alive = true;
    // Until the new store loads, nothing may be saved or recorded against it.
    latest.current = null;
    setPortfolio(null);
    setLoadError("");
    store
      .load()
      .then((p) => {
        if (!alive) return;
        latest.current = p;
        setPortfolio(p);
        setSelected((s) => s || p.watchlist[0] || p.positions[0]?.symbol || "SPY");
      })
      .catch((e: Error) => {
        if (!alive) return;
        setLoadError(
          store.kind === "sync" && e instanceof ApiError && e.status === 404
            ? "No synced portfolio matches the saved sign-in. Sign out, then sign in again or create the account."
            : e.message,
        );
      });
    const unsubscribe = store.subscribe?.((p) => {
      latest.current = p;
      setPortfolio(p);
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [store]);
  /** Applies saves one at a time to the newest saved portfolio, so quick edits never race. */
  const update: Update = useCallback(
    (change) => {
      const run = queue.current.then(async () => {
        const base = latest.current;
        if (!base) throw new Error("The portfolio has not loaded yet.");
        try {
          const saved = await store.save(change(base));
          latest.current = saved;
          setPortfolio(saved);
          setError("");
          return saved;
        } catch (e) {
          const message = (e as Error).message;
          if (/another (tab|device)/.test(message)) {
            const fresh = await store.load().catch(() => null);
            if (fresh) {
              latest.current = fresh;
              setPortfolio(fresh);
            }
            setError(
              `${message.split(".")[0]}. Pulse loaded the latest version; your last change was not saved.`,
            );
          } else setError(message);
          throw e;
        }
      });
      queue.current = run.catch(() => {});
      return run;
    },
    [store],
  );
  const loadSample = () =>
    update((p) => ({ ...samplePortfolio, revision: p.revision }));
  /* ---------- market data ---------- */
  useEffect(() => {
    api<MarketStatus>("/status")
      .then(setStatus)
      .catch((e: Error) =>
        setStatusError(
          `${e.message} Market data is unavailable; your portfolio still loads.`,
        ),
      );
  }, []);
  const symbols = useMemo(
    () => [
      ...new Set([
        ...(portfolio?.positions.map((p) => p.symbol) || []),
        ...(portfolio?.watchlist || []),
      ]),
    ],
    [portfolio],
  );
  const symbolKey = symbols.join(",");
  const refresh = useCallback(async () => {
    if (!symbolKey) {
      setQuotes([]);
      return;
    }
    setRefreshing(true);
    try {
      const data = await api<{ quotes: Quote[]; fetchedAt: string }>(
        "/quotes?symbols=" + encodeURIComponent(symbolKey),
      );
      setQuotes(data.quotes);
      setFetchedAt(data.fetchedAt);
      setQuoteError("");
      const p = latest.current;
      if (store.record && p?.positions.length && status) {
        const v = valuePortfolio(p, data.quotes);
        if (v.totalValue !== null) {
          store.record(v.totalValue, p, `${status.provider}:${status.recency}`);
          setSnapshotTick((t) => t + 1);
        }
      }
    } catch (e) {
      setQuoteError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [symbolKey, store, status]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, status?.pollMs || 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, status?.pollMs]);
  const quoteMap = useMemo(() => new Map(quotes.map((q) => [q.symbol, q])), [quotes]);
  /* ---------- account ---------- */
  const signedIn = (c: SyncCredentials) => {
    setDialog("");
    setStore(syncStore(c));
  };
  const signOut = () => {
    forgetSession();
    setStore(browserStore());
  };
  const chooseContract = (c: OptionContract) => {
    setContract(c);
    navigate("bsm");
  };
  const ready = portfolio !== null;
  const pageProps = { status, quotes: quoteMap, symbols, selected, setSelected };
  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <div className="app">
        <aside className="sidebar" aria-label="Main">
          <Brand />
          <nav className="nav">
            {navigation.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                className="nav-item"
                aria-current={page === n.id ? "page" : undefined}
              >
                <n.icon size={18} aria-hidden />
                {n.label}
              </a>
            ))}
          </nav>
          <div className="sidebar-foot">
            <StorageChip store={store} onClick={() => navigate("settings")} />
            <ThemeSwitch value={themeChoice} onChange={chooseTheme} />
          </div>
        </aside>
        <div className="main">
          <header className="mobile-bar">
            <Brand />
            <StorageChip store={store} compact onClick={() => navigate("settings")} />
          </header>
          <FreshnessBar
            status={status}
            statusError={statusError}
            quotes={quotes}
            fetchedAt={fetchedAt}
            quoteError={quoteError}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
          <main className="content" id="content">
            {status?.provider === "demo" && (
              <Notice kind="warn">
                <b>Simulated data.</b> Prices, news and option chains are generated for
                previewing the app and do not describe real markets.
              </Notice>
            )}
            {error && (
              <Notice kind="error" onDismiss={() => setError("")}>
                {error}
              </Notice>
            )}
            {loadError ? (
              <Notice
                kind="error"
                action={
                  store.kind === "sync" ? (
                    <button className="button" onClick={signOut}>
                      Sign out
                    </button>
                  ) : (
                    <button className="button" onClick={() => setStore(initialStore())}>
                      Try again
                    </button>
                  )
                }
              >
                Your portfolio could not be loaded. {loadError}
              </Notice>
            ) : !ready ? (
              <Empty title="Loading your portfolio…" />
            ) : (
              <Suspense fallback={<Empty title="Loading…" />}>
                {page === "dashboard" && (
                  <Overview
                    {...pageProps}
                    portfolio={portfolio}
                    quoteList={quotes}
                    fetchedAt={fetchedAt}
                    store={store}
                    snapshotTick={snapshotTick}
                    update={update}
                    onEdit={() => setDialog("editor")}
                    onAddSymbol={() => setDialog("symbol")}
                    onSample={() => void loadSample().catch(() => {})}
                  />
                )}
                {page === "news" && <News {...pageProps} />}
                {page === "options" && (
                  <Options {...pageProps} chooseContract={chooseContract} />
                )}
                {page === "bsm" && (
                  <Pricing
                    {...pageProps}
                    contract={contract}
                    clearContract={() => setContract(null)}
                  />
                )}
                {page === "settings" && (
                  <Settings
                    portfolio={portfolio}
                    status={status}
                    store={store}
                    update={update}
                    theme={themeChoice}
                    setTheme={chooseTheme}
                    onSample={loadSample}
                    onAccount={() => setDialog("account")}
                    onSignOut={signOut}
                  />
                )}
              </Suspense>
            )}
          </main>
          <footer className="site-foot">
            <span>
              Pulse · personal portfolio dashboard. Not investment advice; no orders are
              placed.
            </span>
            <span>
              Model:{" "}
              <a href="https://github.com/Ferrsir/options-pricer" target="_blank" rel="noreferrer">
                Ferrsir/options-pricer
              </a>
            </span>
          </footer>
        </div>
        <nav className="tabbar" aria-label="Main">
          {navigation.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              aria-current={page === n.id ? "page" : undefined}
            >
              <n.icon size={20} aria-hidden />
              <span>{n.short}</span>
            </a>
          ))}
        </nav>
        {dialog === "editor" && portfolio && (
          <PortfolioEditor
            portfolio={portfolio}
            update={update}
            onClose={() => setDialog("")}
          />
        )}
        {dialog === "symbol" && portfolio && (
          <SymbolDialog
            portfolio={portfolio}
            update={update}
            onClose={() => setDialog("")}
          />
        )}
        {dialog === "account" && (
          <AccountDialog
            guest={store.kind === "browser" ? portfolio : null}
            onDone={signedIn}
            onClose={() => setDialog("")}
          />
        )}
      </div>
    </ThemeContext.Provider>
  );
}
function Brand() {
  return (
    <a href="#dashboard" className="brand" aria-label="Pulse overview">
      <span className="brand-mark" aria-hidden>
        <Activity size={16} strokeWidth={2.4} />
      </span>
      Pulse
    </a>
  );
}
function StorageChip({
  store,
  compact = false,
  onClick,
}: {
  store: PortfolioStore;
  compact?: boolean;
  onClick: () => void;
}) {
  const [Icon, title, sub] =
    store.kind === "sync"
      ? [Cloud, store.label.split("· ").pop(), "Synced · encrypted"]
      : store.kind === "browser"
        ? [Laptop, "This browser", "Sign in to sync"]
        : [HardDrive, "This computer", "Local SQLite"];
  return (
    <button
      className={`storage-chip ${compact ? "compact" : ""} ${store.kind}`}
      onClick={onClick}
      title={store.label}
    >
      <Icon size={16} aria-hidden />
      <span>
        <b>{title}</b>
        {!compact && <small>{sub}</small>}
      </span>
    </button>
  );
}
function ThemeSwitch({
  value,
  onChange,
}: {
  value: ThemeChoice;
  onChange: (t: ThemeChoice) => void;
}) {
  const options: [ThemeChoice, typeof Sun, string][] = [
    ["system", Monitor, "Match system theme"],
    ["light", Sun, "Light theme"],
    ["dark", Moon, "Dark theme"],
  ];
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {options.map(([v, Icon, label]) => (
        <button
          key={v}
          aria-pressed={value === v}
          aria-label={label}
          title={label}
          onClick={() => onChange(v)}
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
/** One honest line about where numbers come from and how old they are. */
function FreshnessBar({
  status,
  statusError,
  quotes,
  fetchedAt,
  quoteError,
  refreshing,
  onRefresh,
}: {
  status: MarketStatus | null;
  statusError: string;
  quotes: Quote[];
  fetchedAt: string;
  quoteError: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  const newest = quotes
      .map((q) => q.asOf)
      .filter((t): t is string => Boolean(t))
      .sort()
      .pop(),
    missing = quotes.filter((q) => q.price === null).map((q) => q.symbol),
    pollMs = status?.pollMs || 60000,
    late = fetchedAt && now - Date.parse(fetchedAt) > 3 * pollMs,
    state =
      statusError || quoteError
        ? "error"
        : !status || !fetchedAt
          ? "pending"
          : late
            ? "late"
            : status.provider === "demo"
              ? "demo"
              : "live",
    source =
      status?.provider === "demo"
        ? "Simulated data"
        : status?.provider === "yahoo"
          ? "Yahoo · Cboe"
          : status?.provider === "massive"
            ? "Massive"
            : "Market data";
  return (
    <div className={`freshness ${state}`} role="status" aria-live="polite">
      <span className="fresh-dot" aria-hidden />
      <span className="fresh-main">
        <b>{source}</b>
        {status && status.provider !== "demo" && <span>{status.recency}</span>}
      </span>
      <span className="fresh-detail">
        {statusError || quoteError ? (
          <span className="fresh-error">{statusError || quoteError}</span>
        ) : (
          <>
            {newest && status?.provider !== "demo" && (
              <span>Last trade {marketClock(newest)}</span>
            )}
            <span>Updated {fetchedAt ? ago(fetchedAt, now) : "—"}</span>
            {status && status.provider !== "demo" && (
              <span title="Regular session Mon–Fri 9:30 AM–4:00 PM ET; exchange holidays are not detected">
                {regularSession(new Date(now)) ? "Regular session" : "Outside regular hours"}
              </span>
            )}
            {missing.length > 0 && (
              <span className="fresh-warn">No quote: {missing.join(", ")}</span>
            )}
          </>
        )}
      </span>
      <button
        className="icon-button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh quotes"
        title="Refresh quotes"
      >
        <RefreshCw size={15} className={refreshing ? "spin" : ""} />
      </button>
    </div>
  );
}
