import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  LayoutDashboard,
  Newspaper,
  Layers3,
  Calculator,
  Settings,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  RefreshCw,
  Download,
  Upload,
  X,
  Trash2,
  ChevronRight,
  Search,
  ExternalLink,
  Wallet,
  Target,
  Info,
  Check,
  Menu,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import type {
  Portfolio,
  Quote,
  Bar,
  MarketStatus,
  NewsItem,
  OptionChain,
  OptionContract,
} from "../shared/types";
import { nearMoneyIV } from "../shared/types";
import { valuePortfolio } from "../shared/portfolio";
import { priceOption, solveIV, daysToExpiry } from "../shared/pricing";
import type { PricingInput } from "../shared/pricing";
import { api } from "./api";
const money = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }).format(n);
const number = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(n);
const percent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const colors = [
  "#b8f572",
  "#63c9ee",
  "#ae94fa",
  "#efb668",
  "#ef83a0",
  "#62dfb7",
];
const navigation = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "news", label: "Market news", icon: Newspaper },
  { id: "options", label: "Options activity", icon: Layers3 },
  { id: "bsm", label: "Pricing lab", icon: Calculator },
  { id: "settings", label: "Data & settings", icon: Settings },
];
type Page = "dashboard" | "news" | "options" | "bsm" | "settings";
const initialPage = (): Page =>
  navigation.some((n) => n.id === location.hash.slice(1))
    ? (location.hash.slice(1) as Page)
    : "dashboard";
function Change({
  value,
  children,
}: {
  value: number | null | undefined;
  children?: ReactNode;
}) {
  return (
    <span
      className={value == null ? "muted" : value >= 0 ? "positive" : "negative"}
    >
      {children || percent(value)}
    </span>
  );
}
function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Activity size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Symbol({
  symbol,
  name,
  small = false,
}: {
  symbol: string;
  name?: string;
  small?: boolean;
}) {
  return (
    <div className="symbol-cell">
      <span
        className={`symbol-avatar ${small ? "small" : ""}`}
        style={{
          color:
            colors[
              [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) %
                colors.length
            ],
        }}
      >
        {symbol.slice(0, 2)}
      </span>
      <span>
        <b>{symbol}</b>
        {name && <small>{name}</small>}
      </span>
    </div>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>(initialPage),
    [portfolio, setPortfolio] = useState<Portfolio | null>(null),
    [status, setStatus] = useState<MarketStatus | null>(null),
    [quotes, setQuotes] = useState<Quote[]>([]),
    [quoteError, setQuoteError] = useState(""),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [editing, setEditing] = useState(false),
    [symbolDialog, setSymbolDialog] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [selected, setSelected] = useState("AAPL"),
    [contract, setContract] = useState<OptionContract | null>(null);
  const symbols = useMemo(
    () => [
      ...new Set([
        ...(portfolio?.watchlist || []),
        ...(portfolio?.positions.map((p) => p.symbol) || []),
      ]),
    ],
    [portfolio],
  );
  const navigate = (value: Page) => {
    location.hash = value;
    setMobileMenu(false);
  };
  useEffect(() => {
    const change = () => setPage(initialPage());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    Promise.all([api<Portfolio>("/portfolio"), api<MarketStatus>("/status")])
      .then(([p, s]) => {
        setPortfolio(p);
        setStatus(s);
        if (p.watchlist[0]) setSelected(p.watchlist[0]);
      })
      .catch((e) => setError(e.message));
  }, []);
  const refresh = useCallback(async () => {
    if (!symbols.length) {
      setQuotes([]);
      return;
    }
    setRefreshing(true);
    try {
      const data = await api<{ quotes: Quote[]; fetchedAt: string }>(
        "/quotes?symbols=" + encodeURIComponent(symbols.join(",")),
      );
      setQuotes(data.quotes);
      setUpdated(data.fetchedAt);
      setQuoteError(
        data.quotes.some((q) => q.price === null)
          ? "Some quotes are unavailable. Portfolio totals stay incomplete until every holding has a quote."
          : "",
      );
    } catch (e) {
      setQuoteError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [symbols]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, status?.pollMs || 15000);
    return () => clearInterval(timer);
  }, [refresh, status?.pollMs]);
  const save = async (p: Portfolio) => {
    try {
      const result = await api<Portfolio>("/portfolio", {
        method: "PUT",
        body: JSON.stringify(p),
      });
      setPortfolio(result);
      setError("");
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };
  const loadSample = async () => {
    if (!portfolio) return;
    await save({
      ...portfolio,
      initialCapital: 25000,
      netContributions: 0,
      cash: 4200,
      positions: [
        { symbol: "AAPL", shares: 35, costBasis: 6650 },
        { symbol: "MSFT", shares: 20, costBasis: 7400 },
        { symbol: "NVDA", shares: 45, costBasis: 5400 },
        { symbol: "TSLA", shares: 5, costBasis: 1350 },
      ],
      watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"],
      isSample: true,
    });
  };
  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
  const chooseContract = (c: OptionContract) => {
    setContract(c);
    navigate("bsm");
  };
  const content = portfolio && status;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
        <a href="#dashboard" className="brand">
          <span className="brand-mark">
            <Activity size={22} />
          </span>
          pulse<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <div className="workspace-card">
          <span className="workspace-icon">
            <Wallet size={17} />
          </span>
          <span>
            My portfolio<small>USD · Local workspace</small>
          </span>
        </div>
        <div className="nav-label">YOUR MARKETS</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "nav-item active" : "nav-item"}
              onClick={() => navigate(n.id as Page)}
            >
              <n.icon size={18} />
              {n.label}
              {page === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="model-note">
            <div>
              <span className="mini-dot" /> YOUR MODEL, CONNECTED
            </div>
            <p>
              Black–Scholes–Merton
              <br />
              from options-pricer
            </p>
            <a
              href="https://github.com/Ferrsir/options-pricer"
              target="_blank"
              rel="noreferrer"
            >
              View source <ArrowUpRight size={13} />
            </a>
          </div>
          <div className="profile">
            <span className="profile-avatar">F</span>
            <span>
              Ferrsir<small>Personal portfolio</small>
            </span>
            <Settings size={15} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-toggle"
              aria-label="Toggle menu"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <b>{navigation.find((n) => n.id === page)?.label}</b>
          </div>
          <div className="topbar-right">
            <span className="feed-badge">
              <span className="mini-dot" />
              {status?.recency || "Connecting"}
            </span>
            <span className="topbar-date">
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Chicago",
              })}
            </span>
          </div>
        </header>
        <main>
          {(error || quoteError) && (
            <div className="alert" role="alert">
              <Info size={17} />
              <span>{error || quoteError}</span>
              <button className="text-button" onClick={() => void refresh()}>
                Retry quotes
              </button>
              <button
                aria-label="Dismiss error"
                className="icon-button"
                onClick={() => {
                  setError("");
                  setQuoteError("");
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {content && status.provider === "demo" && (
            <div className="demo-note">
              <span className="demo-tag">DEMO</span>Prices, news, and options
              are simulated.{" "}
              {portfolio.isSample
                ? "Portfolio holdings are also examples."
                : "Your entered holdings are saved locally."}
              <button
                className="text-button"
                onClick={() => navigate("settings")}
              >
                Connect data <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {!content ? (
            <Empty title="Opening your workspace">
              Loading portfolio and data configuration…
            </Empty>
          ) : (
            <>
              {page === "dashboard" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">THE BIG PICTURE</div>
                      <h1>
                        Your portfolio, in focus
                        <span className="heading-dot">.</span>
                      </h1>
                      <p>
                        A clear view of your positions and the markets moving
                        them.
                      </p>
                    </div>
                    <div className="heading-actions">
                      <button
                        className="button secondary"
                        onClick={() => void refresh()}
                        disabled={refreshing}
                      >
                        <RefreshCw
                          size={15}
                          className={refreshing ? "spin" : ""}
                        />
                        Refresh
                      </button>
                      <button
                        className="button primary"
                        onClick={() => setEditing(true)}
                      >
                        <Plus size={16} />
                        Manage portfolio
                      </button>
                    </div>
                  </div>
                  <Dashboard
                    portfolio={portfolio}
                    quotes={quotes}
                    selected={selected}
                    setSelected={setSelected}
                    updated={updated}
                    setEditing={setEditing}
                    setSymbolDialog={setSymbolDialog}
                    save={save}
                    loadSample={loadSample}
                  />
                </>
              )}
              {page === "news" && <NewsPage symbols={symbols} />}
              {page === "options" && (
                <OptionsPage
                  symbols={symbols}
                  selected={selected}
                  setSelected={setSelected}
                  quotes={quoteMap}
                  chooseContract={chooseContract}
                />
              )}
              {page === "bsm" && (
                <PricingPage
                  symbols={symbols}
                  selected={selected}
                  setSelected={setSelected}
                  quotes={quoteMap}
                  contract={contract}
                  clearContract={() => setContract(null)}
                />
              )}
              {page === "settings" && (
                <SettingsPage
                  portfolio={portfolio}
                  status={status}
                  save={save}
                  loadSample={loadSample}
                />
              )}
            </>
          )}
        </main>
        <footer>
          <span>Pulse · Portfolio intelligence</span>
          <span>
            {status?.provider === "demo"
              ? "Simulated market data"
              : status?.provider === "yahoo"
                ? "Yahoo / Cboe · delayed data"
                : "Massive · data subject to plan entitlements"}{" "}
            <span className="footer-separator">/</span> USD
          </span>
        </footer>
      </div>
      {editing && portfolio && (
        <PortfolioEditor
          portfolio={portfolio}
          onClose={() => setEditing(false)}
          save={save}
        />
      )}
      {symbolDialog && portfolio && (
        <SymbolDialog
          portfolio={portfolio}
          save={save}
          onClose={() => setSymbolDialog(false)}
        />
      )}
    </div>
  );
}
function Dashboard({
  portfolio,
  quotes,
  selected,
  setSelected,
  updated,
  setEditing,
  setSymbolDialog,
  save,
  loadSample,
}: {
  portfolio: Portfolio;
  quotes: Quote[];
  selected: string;
  setSelected: (s: string) => void;
  updated: string;
  setEditing: (b: boolean) => void;
  setSymbolDialog: (b: boolean) => void;
  save: (p: Portfolio) => Promise<Portfolio>;
  loadSample: () => Promise<void>;
}) {
  const valuation = valuePortfolio(portfolio, quotes),
    [range, setRange] = useState("1M"),
    [bars, setBars] = useState<Bar[]>([]),
    [chartError, setChartError] = useState(""),
    [chartMode, setChartMode] = useState<"stock" | "portfolio">("stock");
  const selectedQuote = quotes.find((q) => q.symbol === selected),
    allocated = valuation.positions
      .filter((p) => p.value !== null)
      .map((p) => ({ name: p.symbol, value: p.value! }));
  if (portfolio.cash) allocated.push({ name: "Cash", value: portfolio.cash });
  useEffect(() => {
    const abort = new AbortController();
    setBars([]);
    setChartError("");
    const path =
      chartMode === "stock"
        ? `/history/${encodeURIComponent(selected)}?range=${range}`
        : "/snapshots";
    api<any[]>(path, { signal: abort.signal })
      .then((rows) =>
        setBars(
          chartMode === "stock"
            ? rows
            : rows.map((r) => ({ time: r.time, close: r.value })),
        ),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setChartError(e.message);
      });
    return () => abort.abort();
  }, [selected, range, chartMode, updated.slice(0, 16)]);
  return (
    <>
      <div className="stats-grid">
        <Stat
          label="TOTAL PORTFOLIO VALUE"
          value={money(valuation.totalValue)}
          note={
            <>
              <span className="mini-dot" />
              Equities + cash{portfolio.isSample ? " · sample" : ""}
            </>
          }
          icon={<Wallet size={17} />}
        />
        <Stat
          label="RETURN SINCE START"
          value={money(valuation.sinceStart)}
          positive={valuation.sinceStart}
          note={
            <>
              <Change value={valuation.returnPercent} />
              <span> vs. contributed capital</span>
            </>
          }
          icon={<ArrowUpRight size={17} />}
        />
        <Stat
          label="UNREALIZED GAIN / LOSS"
          value={money(valuation.unrealized)}
          positive={valuation.unrealized}
          note={
            <>
              Cost basis <b>{money(valuation.invested, 0)}</b>
            </>
          }
          icon={<Activity size={17} />}
        />
        <Stat
          label="CASH AVAILABLE"
          value={money(portfolio.cash)}
          note={
            <>
              Starting amount <b>{money(portfolio.initialCapital, 0)}</b>
            </>
          }
          icon={<Target size={17} />}
        />
      </div>
      {!portfolio.positions.length && (
        <div className="onboarding">
          <div>
            <b>Make this workspace yours</b>
            <p>
              Add your shares, total cost basis, starting amount, and cash
              balance.
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => void loadSample().catch(() => {})}
          >
            Try a sample portfolio
          </button>
          <button className="button primary" onClick={() => setEditing(true)}>
            Add holdings <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      <div className="charts-grid">
        <Panel className="movement-panel">
          <div className="panel-heading">
            <div>
              <h2>
                {chartMode === "stock"
                  ? "Market movement"
                  : "Recorded portfolio value"}
              </h2>
              <p>
                {chartMode === "stock"
                  ? `${selectedQuote?.name || selected} · ${selected}`
                  : "Snapshots since the last holdings or cash edit"}
              </p>
            </div>
            <select
              aria-label="Chart view"
              value={chartMode}
              onChange={(e) =>
                setChartMode(e.target.value as "stock" | "portfolio")
              }
            >
              <option value="stock">Stock chart</option>
              <option value="portfolio">Portfolio value</option>
            </select>
          </div>
          <div className="chart-toolbar">
            <div>
              <strong className="chart-value">
                {chartMode === "stock"
                  ? money(selectedQuote?.price)
                  : money(valuation.totalValue)}
              </strong>
              {chartMode === "stock" && (
                <Change value={selectedQuote?.changePercent} />
              )}
            </div>
            {chartMode === "stock" && (
              <div className="range-group">
                {["1D", "1W", "1M", "3M", "1Y"].map((r) => (
                  <button
                    className={range === r ? "selected" : ""}
                    key={r}
                    onClick={() => setRange(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="main-chart">
            {bars.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={bars}
                  margin={{ top: 15, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#b8f572"
                        stopOpacity={0.18}
                      />
                      <stop offset="100%" stopColor="#b8f572" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="#252c35"
                    strokeDasharray="3 5"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) =>
                      new Date(t).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    axisLine={false}
                    tickLine={false}
                    minTickGap={50}
                    tick={{ fill: "#798493", fontSize: 11 }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => money(v, 0)}
                    width={68}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#798493", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#171f2b",
                      border: "1px solid #303b48",
                      borderRadius: 8,
                    }}
                    labelFormatter={(t) => new Date(String(t)).toLocaleString()}
                    formatter={(v) => [
                      money(Number(v)),
                      chartMode === "stock" ? selected : "Portfolio",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke="#b8f572"
                    strokeWidth={2.2}
                    fill="url(#price-fill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title={
                  chartError
                    ? "Chart unavailable"
                    : chartMode === "portfolio"
                      ? "Your history starts here"
                      : "Loading market chart"
                }
              >
                {chartError ||
                  (chartMode === "portfolio"
                    ? "Portfolio snapshots record once per minute while the app is open."
                    : "Fetching price history…")}
              </Empty>
            )}
          </div>
          <div className="chart-footnote">
            <span>
              <span className="mini-dot" />
              {chartMode === "stock"
                ? "Price history"
                : "Observed value · no backfilled performance"}
            </span>
            <span>
              Last refresh{" "}
              {updated
                ? new Date(updated).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "—"}
            </span>
          </div>
        </Panel>
        <Panel className="allocation-panel">
          <div className="panel-heading">
            <div>
              <h2>Allocation</h2>
              <p>Where your capital lives</p>
            </div>
            <span className="pill">{portfolio.positions.length} holdings</span>
          </div>
          <div className="donut-wrap">
            {allocated.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={allocated}
                      innerRadius={77}
                      outerRadius={101}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {allocated.map((_, i) => (
                        <Cell fill={colors[i % colors.length]} key={i} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => money(Number(v))}
                      contentStyle={{
                        background: "#171f2b",
                        border: "1px solid #303b48",
                        borderRadius: 8,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <small>INVESTED</small>
                  <b>{money(valuation.equityValue, 0)}</b>
                  <span>across your holdings</span>
                </div>
              </>
            ) : (
              <Empty title="No allocation yet">
                Your positions appear here.
              </Empty>
            )}
          </div>
          <div className="allocation-legend">
            {allocated.map((a, i) => (
              <div key={a.name}>
                <span className="legend-name">
                  <i style={{ background: colors[i % colors.length] }} />
                  {a.name}
                </span>
                <b>
                  {valuation.totalValue
                    ? number((a.value / valuation.totalValue) * 100, 1) + "%"
                    : "—"}
                </b>
                <span>{money(a.value, 0)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel className="holdings-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Your holdings{" "}
              {portfolio.isSample && <span className="pill">SAMPLE</span>}
            </h2>
            <p>Position value and returns at a glance</p>
          </div>
          <button className="text-button" onClick={() => setEditing(true)}>
            Edit holdings <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ASSET</th>
                <th>PRICE</th>
                <th>DAY CHANGE</th>
                <th>SHARES</th>
                <th>COST BASIS</th>
                <th>MARKET VALUE</th>
                <th>UNREALIZED P&L</th>
              </tr>
            </thead>
            <tbody>
              {valuation.positions.map((p) => (
                <tr key={p.symbol}>
                  <td>
                    <button
                      className="asset-button"
                      onClick={() => setSelected(p.symbol)}
                    >
                      <Symbol symbol={p.symbol} name={p.quote?.name} />
                    </button>
                  </td>
                  <td>{money(p.price)}</td>
                  <td>
                    <Change value={p.quote?.changePercent} />
                  </td>
                  <td>{number(p.shares, 6)}</td>
                  <td>{money(p.costBasis)}</td>
                  <td className="emphasis">{money(p.value)}</td>
                  <td>
                    <Change value={p.gain}>{money(p.gain)}</Change>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!portfolio.positions.length && (
            <div className="table-empty">
              No holdings added yet. Your watchlist below is ready to explore.
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            Long stock positions · total cost basis includes fees you enter
          </span>
          <span>
            Today's holdings move{" "}
            <Change value={valuation.dayChange}>
              {money(valuation.dayChange)}
            </Change>
          </span>
        </div>
      </Panel>
      <div className="section-heading">
        <div>
          <h2>
            Your watchlist <span>{portfolio.watchlist.length}</span>
          </h2>
          <p>The stocks on your radar.</p>
        </div>
        <button
          className="button secondary small-button"
          onClick={() => setSymbolDialog(true)}
        >
          <Plus size={14} />
          Add symbol
        </button>
      </div>
      <div className="watchlist-grid">
        {portfolio.watchlist.map((symbol, i) => {
          const q = quotes.find((q) => q.symbol === symbol);
          return (
            <div
              className={`watch-card ${selected === symbol ? "selected" : ""}`}
              key={symbol}
            >
              <button
                className="watch-main"
                onClick={() => setSelected(symbol)}
              >
                <div className="watch-top">
                  <Symbol symbol={symbol} small />
                  <span className="quote-source-dot" />
                </div>
                <small className="watch-name">{q?.name || symbol}</small>
                <div className="watch-price">
                  {money(q?.price)}
                  <Change value={q?.changePercent} />
                </div>
                <div className="watch-link">
                  <span>View price history</span>
                  <ArrowUpRight size={13} />
                </div>
                <small className="watch-asof">
                  {q?.asOf
                    ? new Date(q.asOf).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Quote unavailable"}{" "}
                  · {q?.source === "Simulated" ? "demo" : "quote"}
                </small>
              </button>
              <button
                className="watch-remove icon-button"
                aria-label={`Remove ${symbol} from watchlist`}
                onClick={() =>
                  void save({
                    ...portfolio,
                    watchlist: portfolio.watchlist.filter((s) => s !== symbol),
                  }).catch(() => {})
                }
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="accounting-note">
        Return since start = current value − starting amount − net
        contributions. This simple return is not time weighted. Portfolio
        history records while the app is open.
      </p>
    </>
  );
}
function Stat({
  label,
  value,
  note,
  icon,
  positive,
}: {
  label: string;
  value: string;
  note: ReactNode;
  icon: ReactNode;
  positive?: number | null;
}) {
  return (
    <Panel className="stat">
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong
        className={
          positive == null ? "" : positive >= 0 ? "positive" : "negative"
        }
      >
        {value}
      </strong>
      <div className="stat-note">{note}</div>
    </Panel>
  );
}
function NewsPage({ symbols }: { symbols: string[] }) {
  const [filter, setFilter] = useState("ALL"),
    [items, setItems] = useState<NewsItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (!symbols.length) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<NewsItem[]>(
      "/news?symbols=" +
        encodeURIComponent((filter === "ALL" ? symbols : [filter]).join(",")),
      { signal: controller.signal },
    )
      .then(setItems)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filter, symbols.join(",")]);
  const visible = items.filter((n) =>
    (n.title + " " + n.publisher).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">STAY IN THE LOOP</div>
          <h1>
            The stories behind the stocks<span className="heading-dot">.</span>
          </h1>
          <p>A focused news feed for the names you follow.</p>
        </div>
        <span className="page-icon">
          <Newspaper size={24} />
        </span>
      </div>
      <div className="filter-toolbar">
        <div className="chip-list">
          {["ALL", ...symbols].map((s) => (
            <button
              className={filter === s ? "chip selected" : "chip"}
              key={s}
              onClick={() => setFilter(s)}
            >
              {s === "ALL" ? "All stocks" : s}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search headlines"
            placeholder="Search headlines"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {loading ? (
        <Empty title="Gathering headlines">
          Loading news for your watchlist…
        </Empty>
      ) : error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : !visible.length ? (
        <Empty title="No headlines found">Try another symbol or search.</Empty>
      ) : (
        <div className="news-grid">
          {visible.map((n, i) => (
            <Panel
              className={`news-card ${i === 0 ? "featured-news" : ""}`}
              key={n.id}
            >
              <div className="news-meta">
                <span>{n.publisher}</span>
                <span>
                  {new Date(n.publishedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="news-symbols">
                {[...new Set(n.symbols)]
                  .filter((s) => symbols.includes(s))
                  .slice(0, 5)
                  .map((s) => (
                    <span className="pill" key={s}>
                      {s}
                    </span>
                  ))}
              </div>
              <h2>{n.title}</h2>
              <p>
                {n.description || "Open the source for the complete story."}
              </p>
              <div className="news-bottom">
                {n.url && /^https?:\/\//.test(n.url) ? (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-button"
                  >
                    Read article <ExternalLink size={14} />
                  </a>
                ) : (
                  <span className="muted">Fictional sample article</span>
                )}
                <Newspaper size={18} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
function OptionsPage({
  symbols,
  selected,
  setSelected,
  quotes,
  chooseContract,
}: {
  symbols: string[];
  selected: string;
  setSelected: (s: string) => void;
  quotes: Map<string, Quote>;
  chooseContract: (c: OptionContract) => void;
}) {
  const [chain, setChain] = useState<OptionChain | null>(null),
    [expiry, setExpiry] = useState(""),
    [kind, setKind] = useState<"call" | "put" | "all">("all"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [sort, setSort] = useState<"strike" | "volume">("strike"),
    [refreshKey, setRefreshKey] = useState(0),
    [expiryChoices, setExpiryChoices] = useState<{
      symbol: string;
      expiries: string[];
    }>({ symbol: selected, expiries: [] });
  useEffect(() => {
    setExpiry("");
    setChain(null);
    setExpiryChoices({ symbol: selected, expiries: [] });
  }, [selected]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<OptionChain>(
      `/options/${encodeURIComponent(selected)}${expiry ? "?expiry=" + expiry : ""}`,
      { signal: controller.signal },
    )
      .then((c) => {
        setChain(c);
        // Keep earlier expiry choices for this underlying when a filtered response lists fewer.
        setExpiryChoices((prev) => ({
          symbol: selected,
          expiries: [
            ...new Set([
              ...(prev.symbol === selected ? prev.expiries : []),
              ...c.expiries,
            ]),
          ].sort(),
        }));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, expiry, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRefreshKey((k) => k + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  const rows = (chain?.contracts || [])
    .filter((o) => kind === "all" || o.type === kind)
    .sort((a, b) =>
      sort === "volume"
        ? (b.volume ?? -1) - (a.volume ?? -1)
        : a.strike - b.strike || a.type.localeCompare(b.type),
    );
  const contracts = chain?.contracts || [],
    callContracts = contracts.filter((c) => c.type === "call"),
    putContracts = contracts.filter((c) => c.type === "put"),
    calls =
      chain && callContracts.every((c) => c.volume !== null)
        ? callContracts
            .filter((c) => c.type === "call")
            .reduce((s, c) => s + c.volume!, 0)
        : null,
    puts =
      chain && putContracts.every((c) => c.volume !== null)
        ? putContracts
            .filter((c) => c.type === "put")
            .reduce((s, c) => s + c.volume!, 0)
        : null,
    spot = quotes.get(selected)?.price,
    atmIV = nearMoneyIV(contracts, spot),
    expiries =
      expiryChoices.symbol === selected
        ? expiryChoices.expiries
        : chain?.expiries || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">READ THE OPTIONS MARKET</div>
          <h1>
            Activity, volatility, opportunity
            <span className="heading-dot">.</span>
          </h1>
          <p>Explore contracts and send any quote into your pricing model.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} />
          Refresh chain
        </button>
      </div>
      <div className="filter-toolbar">
        <div className="inline-fields">
          <label>
            Underlying
            <select
              aria-label="Options underlying"
              value={selected}
              onChange={(e) => {
                setChain(null);
                setExpiry("");
                setSelected(e.target.value);
              }}
            >
              {[...new Set([selected, ...symbols])].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Expiration
            <select
              aria-label="Expiration"
              value={expiry || chain?.contracts[0]?.expiry || ""}
              onChange={(e) => {
                setChain(null);
                setExpiry(e.target.value);
              }}
            >
              {expiries.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="range-group">
          {(["all", "call", "put"] as const).map((k) => (
            <button
              className={kind === k ? "selected" : ""}
              key={k}
              onClick={() => setKind(k)}
            >
              {k === "all" ? "All contracts" : k === "call" ? "Calls" : "Puts"}
            </button>
          ))}
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="UNDERLYING PRICE"
          value={money(spot)}
          note={<Change value={quotes.get(selected)?.changePercent} />}
          icon={<Activity size={17} />}
        />
        <Stat
          label="NEAR-THE-MONEY IV"
          value={atmIV == null ? "—" : number(atmIV * 100, 1) + "%"}
          note={
            spot == null
              ? "Needs an underlying price"
              : "Avg. call/put IV · nearest strike"
          }
          icon={<Layers3 size={17} />}
        />
        <Stat
          label="DISPLAYED CALL VOLUME"
          value={number(calls, 0)}
          note="Contracts · selected expiry"
          icon={<ArrowUpRight size={17} />}
        />
        <Stat
          label="PUT / CALL VOLUME"
          value={calls && puts !== null ? number(puts / calls, 2) : "—"}
          note="Displayed contracts only"
          icon={<ArrowDownRight size={17} />}
        />
      </div>
      <div className="info-note">
        <Info size={16} />
        <span>
          Volume and open interest show activity. They do not identify buyers,
          sellers, opening trades, or trader intent. IV is annualized. News and
          chain quotes may have different timestamps.
        </span>
      </div>
      {chain?.truncated && (
        <div className="alert">
          This chain is partial (provider pagination capped). Metrics describe
          only displayed contracts. Enter a specific expiry to narrow the
          request.
        </div>
      )}
      <Panel>
        <div className="panel-heading">
          <div>
            <h2>{selected} option chain</h2>
            <p>
              {chain?.source || "Loading provider"}
              {chain?.snapshotGeneratedAt &&
                ` · snapshot generated ${new Date(chain.snapshotGeneratedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`}{" "}
              · updates every minute · select a row to price it
            </p>
          </div>
          <select
            aria-label="Sort options"
            value={sort}
            onChange={(e) => setSort(e.target.value as "strike" | "volume")}
          >
            <option value="strike">Sort by strike</option>
            <option value="volume">Highest volume</option>
          </select>
        </div>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : loading && !chain ? (
          <Empty title="Fetching the chain">Loading available contracts…</Empty>
        ) : !rows.length ? (
          <Empty title="No contracts available">
            Try another stock or expiry.
          </Empty>
        ) : (
          <div className="table-wrap option-table">
            <table>
              <thead>
                <tr>
                  <th>TYPE</th>
                  <th>STRIKE</th>
                  <th>BID</th>
                  <th>ASK</th>
                  <th>MID</th>
                  <th>IV</th>
                  <th>VOLUME</th>
                  <th>OPEN INTEREST</th>
                  <th>DELTA</th>
                  <th>QUOTE TIME</th>
                  <th>MODEL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const mid =
                    c.bid !== null &&
                    c.ask !== null &&
                    c.bid >= 0 &&
                    c.ask >= c.bid
                      ? (c.bid + c.ask) / 2
                      : null;
                  return (
                    <tr key={c.ticker}>
                      <td>
                        <span className={`option-kind ${c.type}`}>
                          {c.type}
                        </span>
                      </td>
                      <td className="emphasis">{money(c.strike)}</td>
                      <td>{money(c.bid)}</td>
                      <td>{money(c.ask)}</td>
                      <td>{money(mid)}</td>
                      <td>
                        {c.iv !== null ? number(c.iv * 100, 1) + "%" : "—"}
                      </td>
                      <td>{number(c.volume, 0)}</td>
                      <td>{number(c.openInterest, 0)}</td>
                      <td>{number(c.delta, 3)}</td>
                      <td>
                        {c.asOf
                          ? new Date(c.asOf).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => chooseContract(c)}
                        >
                          Price <ArrowUpRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
function PricingPage({
  symbols,
  selected,
  setSelected,
  quotes,
  contract,
  clearContract,
}: {
  symbols: string[];
  selected: string;
  setSelected: (s: string) => void;
  quotes: Map<string, Quote>;
  contract: OptionContract | null;
  clearContract: () => void;
}) {
  const [input, setInput] = useState<PricingInput>(() => ({
      spot: quotes.get(selected)?.price || 100,
      strike:
        contract?.strike || Math.round(quotes.get(selected)?.price || 100),
      days: contract ? daysToExpiry(contract.expiry) : 30,
      rate: 0.04,
      iv: contract?.iv ?? 0.3,
      dividend: 0,
      type: contract?.type || "call",
      multiplier: contract?.multiplier || 100,
    })),
    [marketPremium, setMarketPremium] = useState<number | "">(() =>
      contract?.bid != null &&
      contract.ask != null &&
      contract.ask >= contract.bid
        ? (contract.bid + contract.ask) / 2
        : "",
    ),
    [message, setMessage] = useState("");
  const inputRef = useRef(input);
  inputRef.current = input;
  useEffect(() => {
    if (contract) {
      setInput((p) => ({
        ...p,
        spot: quotes.get(selected)?.price || p.spot,
        strike: contract.strike,
        days: daysToExpiry(contract.expiry),
        iv: contract.iv ?? p.iv,
        type: contract.type,
        multiplier: contract.multiplier,
      }));
      setMarketPremium(
        contract.bid != null &&
          contract.ask != null &&
          contract.ask >= contract.bid
          ? (contract.bid + contract.ask) / 2
          : "",
      );
    }
  }, [contract]);
  let result: ReturnType<typeof priceOption> | null = null,
    validation = "";
  try {
    result = priceOption(input);
  } catch (e) {
    validation = (e as Error).message;
  }
  const sensitivity = useMemo(
    () =>
      Array.from({ length: 41 }, (_, i) => {
        const iv = i * 0.025;
        try {
          return {
            iv: iv * 100,
            premium: priceOption({ ...input, iv }).premium,
          };
        } catch {
          return { iv: iv * 100, premium: 0 };
        }
      }),
    [input],
  );
  const field = (
    key: keyof PricingInput,
    label: string,
    unit = "",
    scale = 1,
    min = 0,
    max?: number,
  ) => (
    <label className="form-field" key={key}>
      {label}
      <span className="input-with-unit">
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step="any"
          value={
            Number.isFinite(Number(input[key]))
              ? Number((Number(input[key]) * scale).toFixed(6))
              : ""
          }
          onChange={(e) =>
            setInput((p) => ({
              ...p,
              [key]:
                e.target.value === "" ? NaN : Number(e.target.value) / scale,
            }))
          }
        />
        <span>{unit}</span>
      </span>
    </label>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EDGE, QUANTIFIED</div>
          <h1>
            A fair premium, at your IV<span className="heading-dot">.</span>
          </h1>
          <p>
            Your options-pricer engine, connected to a practical pricing
            workspace.
          </p>
        </div>
        <a
          className="button secondary"
          href="https://github.com/Ferrsir/options-pricer"
          target="_blank"
          rel="noreferrer"
        >
          Model source <ExternalLink size={14} />
        </a>
      </div>
      {contract && (
        <div className="contract-banner">
          <Layers3 size={16} />
          <span>
            {selected} {contract.expiry} · {money(contract.strike)}{" "}
            {contract.type.toUpperCase()} ·{" "}
            {contract.iv == null
              ? "IV unavailable — using your input"
              : `Provider IV ${number(contract.iv * 100, 2)}%`}
          </span>
          <button className="text-button" onClick={clearContract}>
            Clear selection
          </button>
        </div>
      )}
      <div className="pricing-grid">
        <Panel className="pricing-inputs">
          <div className="panel-heading">
            <div>
              <h2>Model inputs</h2>
              <p>European BSM · ACT/365</p>
            </div>
            <Calculator size={18} />
          </div>
          <div className="input-body">
            <div className="inline-fields">
              <label>
                Stock
                <select
                  aria-label="Pricing stock"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    clearContract();
                  }}
                >
                  {[...new Set([selected, ...symbols])].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary small-button"
                disabled={quotes.get(selected)?.price == null}
                onClick={() =>
                  setInput((p) => ({
                    ...p,
                    spot: quotes.get(selected)!.price!,
                  }))
                }
              >
                Use latest price
              </button>
            </div>
            <div className="type-toggle">
              {(["call", "put"] as const).map((k) => (
                <button
                  key={k}
                  className={input.type === k ? "selected" : ""}
                  onClick={() => setInput((p) => ({ ...p, type: k }))}
                >
                  {k === "call" ? "Call option" : "Put option"}
                </button>
              ))}
            </div>
            <div className="form-grid">
              {field("spot", "Stock price", "$")}
              {field("strike", "Strike price", "$")}
              {field("days", "Time to expiry", "days")}
              {field("rate", "Risk-free rate", "%", 100, -100, 100)}
              {field("iv", "Implied volatility", "%", 100, 0, 500)}
              {field("dividend", "Dividend yield", "%", 100, 0, 100)}
              {field("multiplier", "Contract multiplier", "shares", 1, 1)}
            </div>
            <label className="iv-slider">
              Explore volatility<span>{number(input.iv * 100, 1)}%</span>
              <input
                aria-label="Explore volatility"
                type="range"
                min="1"
                max="150"
                value={input.iv * 100}
                onChange={(e) =>
                  setInput((p) => ({ ...p, iv: Number(e.target.value) / 100 }))
                }
              />
              <small>
                <span>1%</span>
                <span>150%</span>
              </small>
            </label>
            <p className="muted">
              Rate and dividend yield are assumptions you enter. Quotes populate
              spot; rates are continuously compounded.
            </p>
          </div>
        </Panel>
        <div className="pricing-results">
          {validation ? (
            <div className="alert" role="alert">
              {validation}
            </div>
          ) : (
            result && (
              <>
                <Panel className="premium-panel">
                  <div className="eyebrow">THEORETICAL BSM PREMIUM</div>
                  <div className="premium-value">
                    {money(result.premium)}
                    <span>/ share</span>
                  </div>
                  <div className="premium-sub">
                    <span>
                      {money(result.contractPremium)} per{" "}
                      {number(input.multiplier, 0)}-share contract
                    </span>
                    <span className="pill">{input.type.toUpperCase()}</span>
                  </div>
                  <div className="premium-details">
                    <div>
                      <span>Intrinsic value</span>
                      <b>{money(result.intrinsic)}</b>
                    </div>
                    <div>
                      <span>American CRR estimate</span>
                      <b>{money(result.american)}</b>
                    </div>
                    <div>
                      <span>Early-exercise difference</span>
                      <b>
                        {money(
                          result.american === null
                            ? null
                            : result.american - result.premium,
                        )}
                      </b>
                    </div>
                  </div>
                </Panel>
                <div className="greeks-grid">
                  {[
                    ["Delta", result.delta, "Per $1 spot"],
                    ["Gamma", result.gamma, "Delta change / $1"],
                    ["Theta", result.thetaDay, "Per calendar day"],
                    ["Vega", result.vegaPoint, "Per IV point"],
                    ["Rho", result.rhoPoint, "Per rate point"],
                  ].map(([label, v, note]) => (
                    <Panel key={String(label)}>
                      <small>{label}</small>
                      <b>{number(v as number | null, 4)}</b>
                      <span>{note}</span>
                    </Panel>
                  ))}
                </div>
                <Panel className="sensitivity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Premium vs. implied volatility</h2>
                      <p>All other inputs held constant</p>
                    </div>
                    <span className="pill">BSM</span>
                  </div>
                  <div className="sensitivity-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={sensitivity}
                        margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="#252c35"
                          strokeDasharray="3 5"
                        />
                        <XAxis
                          dataKey="iv"
                          tickFormatter={(v) => v + "%"}
                          tick={{ fill: "#798493", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          width={60}
                          tickFormatter={(v) => money(v, 0)}
                          tick={{ fill: "#798493", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(v) => [money(Number(v)), "Premium"]}
                          labelFormatter={(v) => `IV ${v}%`}
                          contentStyle={{
                            background: "#171f2b",
                            border: "1px solid #303b48",
                            borderRadius: 8,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="premium"
                          stroke="#b8f572"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <ReferenceLine
                          x={Math.round((input.iv * 100) / 2.5) * 2.5}
                          stroke="#81916b"
                          strokeDasharray="4 4"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </>
            )
          )}
          <Panel className="market-compare">
            <div className="panel-heading">
              <div>
                <h2>Compare with a market premium</h2>
                <p>Per share · midpoint is not an executable fill</p>
              </div>
            </div>
            <div className="compare-body">
              <label className="form-field">
                Market premium ($/share)
                <input
                  aria-label="Market premium"
                  type="number"
                  min="0"
                  step="any"
                  value={
                    marketPremium === "" || !Number.isFinite(marketPremium)
                      ? ""
                      : Number(marketPremium.toFixed(6))
                  }
                  onChange={(e) => {
                    setMessage("");
                    setMarketPremium(
                      e.target.value === "" ? "" : Number(e.target.value),
                    );
                  }}
                />
              </label>
              <div>
                <small>Market − BSM</small>
                <b>
                  {money(
                    marketPremium === "" || !result
                      ? null
                      : marketPremium - result.premium,
                  )}
                </b>
              </div>
              <button
                className="button secondary"
                disabled={marketPremium === "" || !result || input.days === 0}
                onClick={() => {
                  const solved = solveIV(
                    Number(marketPremium),
                    inputRef.current,
                  );
                  if (!Number.isFinite(solved))
                    setMessage(
                      "No BSM IV found within 0.01%–500%. Check price bounds and inputs.",
                    );
                  else {
                    setInput((p) => ({ ...p, iv: solved }));
                    setMessage(`Solved BSM IV: ${number(solved * 100, 2)}%`);
                  }
                }}
              >
                Solve market IV
              </button>
            </div>
            {message && (
              <p className="solve-message" role="status">
                {message}
              </p>
            )}
          </Panel>
        </div>
      </div>
      <div className="info-note">
        <Info size={16} />
        <span>
          BSM is a European-option model with constant volatility and continuous
          dividends. American stock options can carry an early-exercise premium;
          your engine's 300-step CRR estimate is shown for comparison. A model
          value is conditional on its assumptions.
        </span>
      </div>
    </>
  );
}
function SettingsPage({
  portfolio,
  status,
  save,
  loadSample,
}: {
  portfolio: Portfolio;
  status: MarketStatus;
  save: (p: Portfolio) => Promise<Portfolio>;
  loadSample: () => Promise<void>;
}) {
  const [message, setMessage] = useState(""),
    [imported, setImported] = useState<Portfolio | null>(null),
    [confirmReset, setConfirmReset] = useState(false);
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...portfolio, exportedAt: new Date().toISOString() },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "pulse-portfolio.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importData = async (file: File) => {
    try {
      if (file.size > 100000)
        throw new Error("Use a JSON export smaller than 100 KB.");
      const p = JSON.parse(await file.text());
      if (
        !Array.isArray(p.positions) ||
        !Array.isArray(p.watchlist) ||
        typeof p.cash !== "number" ||
        typeof p.initialCapital !== "number"
      )
        throw new Error("This is not a Pulse portfolio export.");
      setImported({ ...p, revision: portfolio.revision });
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h1>
            Your data, your workspace<span className="heading-dot">.</span>
          </h1>
          <p>
            Local storage, clear data sources, and a model you already know.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Market connection</h2>
              <p>Current provider: {status.provider}</p>
            </div>
            <span className="pill">
              {status.configured ? "Configured" : "Key required"}
            </span>
          </div>
          <div className="settings-body">
            <div className="connection-row">
              <span className="mini-dot" />
              <b>{status.recency}</b>
              <span>{number(status.pollMs / 1000, 0)}s quote refresh</span>
            </div>
            <p>
              Configure your provider in the project's <code>.env</code> file,
              then restart the server.
            </p>
            <div className="config-example">
              <b>Free delayed data · no API key</b>
              <pre>MARKET_PROVIDER=yahoo</pre>
              <small>
                Yahoo stock quotes, charts, and news; Cboe delayed options.
                Unofficial endpoints can change or rate limit.
              </small>
            </div>
            <div className="config-example">
              <b>Documented provider · paid entitlements</b>
              <pre>
                MARKET_PROVIDER=massive
                <br />
                MASSIVE_API_KEY=your_key
                <br />
                MARKET_DATA_RECENCY=delayed
              </pre>
              <small>
                Set recency to realtime only when your stocks and options
                subscriptions both include it. API keys stay on the server.
              </small>
            </div>
            <a
              href="https://docs.alpaca.markets/us/docs/about-market-data-api"
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              Compare Alpaca's free and $99 plans <ExternalLink size={13} />
            </a>
            <p className="muted">
              Alpaca is a future adapter; this version supports demo,
              Yahoo/Cboe, and Massive. No broker orders are placed.
            </p>
          </div>
        </Panel>
        <div className="settings-stack">
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Portfolio backups</h2>
                <p>Stored on this computer in data/portfolio.sqlite</p>
              </div>
              <Download size={18} />
            </div>
            <div className="settings-body">
              <p>
                Export a JSON backup to keep your holdings, cash, watchlist, and
                starting balance. Imports replace the current portfolio after
                review.
              </p>
              <div className="button-row">
                <button className="button secondary" onClick={exportData}>
                  <Download size={15} />
                  Export JSON
                </button>
                <label className="button secondary upload-button">
                  <Upload size={15} />
                  Import JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      if (e.target.files?.[0])
                        void importData(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {imported && (
                <div className="import-review">
                  <b>Replace with {imported.positions.length} holdings?</b>
                  <p>
                    Starting {money(imported.initialCapital)} · cash{" "}
                    {money(imported.cash)}
                  </p>
                  <button
                    className="button primary"
                    onClick={() =>
                      void save({ ...imported, revision: portfolio.revision })
                        .then(() => {
                          setImported(null);
                          setMessage("Backup imported.");
                        })
                        .catch((e) => setMessage(e.message))
                    }
                  >
                    Import and replace
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setImported(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {message && <p role="status">{message}</p>}
            </div>
          </Panel>
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Your pricing engine</h2>
                <p>Original code, preserved</p>
              </div>
              <Check size={18} className="positive" />
            </div>
            <div className="settings-body">
              <p>
                Imported from{" "}
                <a
                  href="https://github.com/Ferrsir/options-pricer"
                  target="_blank"
                  rel="noreferrer"
                >
                  Ferrsir/options-pricer
                </a>
                , commit <code>68c3636</code>. The BSM, Greeks, IV solver, and
                American tree run locally in your browser.
              </p>
            </div>
          </Panel>
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Sample workspace</h2>
                <p>
                  {portfolio.isSample
                    ? "Example holdings are loaded"
                    : "Your own portfolio"}
                </p>
              </div>
            </div>
            <div className="settings-body">
              <p>
                Load examples only into an empty portfolio, or clear the
                workspace to start your own.
              </p>
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={portfolio.positions.length > 0}
                  onClick={() =>
                    void loadSample().catch((e) => setMessage(e.message))
                  }
                >
                  Load sample
                </button>
                <button
                  className="button danger"
                  onClick={() => setConfirmReset(true)}
                >
                  Clear portfolio
                </button>
              </div>
              {confirmReset && (
                <div className="import-review">
                  <p>
                    Clear holdings, balances, and recorded chart history? Export
                    a backup first if needed.
                  </p>
                  <button
                    className="button danger"
                    onClick={() =>
                      void save({
                        ...portfolio,
                        positions: [],
                        cash: 0,
                        initialCapital: 0,
                        netContributions: 0,
                        isSample: false,
                      })
                        .then(() => setConfirmReset(false))
                        .catch((e) => setMessage(e.message))
                    }
                  >
                    Clear now
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button,input,select,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function PortfolioEditor({
  portfolio,
  save,
  onClose,
}: {
  portfolio: Portfolio;
  save: (p: Portfolio) => Promise<Portfolio>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Portfolio>(() =>
      structuredClone(portfolio),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const changePosition = (i: number, key: string, value: string) =>
    setDraft((p) => ({
      ...p,
      positions: p.positions.map((row, j) =>
        i === j
          ? {
              ...row,
              [key]: key === "symbol" ? value.toUpperCase() : Number(value),
            }
          : row,
      ),
    }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await save({
        ...draft,
        isSample: false,
        watchlist: [
          ...new Set([
            ...draft.watchlist,
            ...draft.positions.map((p) => p.symbol),
          ]),
        ].slice(0, 50),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Manage your portfolio" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="modal-description">
          Enter your current long positions. Total cost basis is the amount paid
          for all shares in that row, including any fees.
        </p>
        <div className="form-grid balance-fields">
          {[
            ["initialCapital", "Starting amount"],
            ["cash", "Current cash"],
            ["netContributions", "Net contributions since start"],
          ].map(([key, label]) => (
            <label className="form-field" key={key}>
              {label} ($)
              <input
                aria-label={label}
                type="number"
                step="any"
                min={key === "netContributions" ? undefined : 0}
                max="1000000000000"
                required
                value={
                  draft[key as "cash" | "initialCapital" | "netContributions"]
                }
                onChange={(e) =>
                  setDraft((p) => ({ ...p, [key]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
        </div>
        <p className="field-help">
          Net contributions = later deposits minus withdrawals. Cash is entered
          separately; adding or editing a holding does not change cash
          automatically.
        </p>
        <div className="editor-header">
          <b>Holdings</b>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              setDraft((p) => ({
                ...p,
                positions: [
                  ...p.positions,
                  { symbol: "", shares: 1, costBasis: 0 },
                ],
              }))
            }
          >
            <Plus size={15} />
            Add holding
          </button>
        </div>
        <div className="holding-editor">
          {draft.positions.map((p, i) => (
            <div className="holding-edit-row" key={i}>
              <label className="form-field">
                Symbol
                <input
                  aria-label={`Holding ${i + 1} symbol`}
                  value={p.symbol}
                  placeholder="AAPL"
                  required
                  pattern="[A-Z][A-Z0-9.\-^]{0,11}"
                  maxLength={12}
                  onChange={(e) => changePosition(i, "symbol", e.target.value)}
                />
              </label>
              <label className="form-field">
                Shares
                <input
                  aria-label={`Holding ${i + 1} shares`}
                  value={p.shares}
                  type="number"
                  required
                  min="0.000001"
                  step="any"
                  onChange={(e) => changePosition(i, "shares", e.target.value)}
                />
              </label>
              <label className="form-field">
                Total cost basis ($)
                <input
                  aria-label={`Holding ${i + 1} cost basis`}
                  value={p.costBasis}
                  type="number"
                  required
                  min="0"
                  step="any"
                  onChange={(e) =>
                    changePosition(i, "costBasis", e.target.value)
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete holding ${i + 1}`}
                onClick={() =>
                  setDraft((p) => ({
                    ...p,
                    positions: p.positions.filter((_, j) => i !== j),
                  }))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        {!draft.positions.length && (
          <div className="table-empty">Add a holding to begin.</div>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save portfolio"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SymbolDialog({
  portfolio,
  save,
  onClose,
}: {
  portfolio: Portfolio;
  save: (p: Portfolio) => Promise<Portfolio>;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="Add a stock to your radar" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await save({
              ...portfolio,
              watchlist: [
                ...new Set([
                  ...portfolio.watchlist,
                  symbol.trim().toUpperCase(),
                ]),
              ],
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <p className="modal-description">
          Follow a US stock or ETF by its ticker symbol.
        </p>
        <label className="form-field">
          Ticker symbol
          <input
            autoFocus
            aria-label="Ticker symbol"
            placeholder="AMZN"
            value={symbol}
            maxLength={12}
            required
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
        </label>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            Add to watchlist
          </button>
        </div>
      </form>
    </Modal>
  );
}
