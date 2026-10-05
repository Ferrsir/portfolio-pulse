import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, X } from "lucide-react";
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
} from "recharts";
import type { Bar, MarketStatus, Portfolio, Quote } from "../../shared/types";
import { valuePortfolio } from "../../shared/portfolio";
import { api, type PortfolioStore } from "../backend";
import type { Update } from "../App";
import {
  money,
  signedMoney,
  number,
  percent,
  marketClock,
  shortDate,
  tone,
} from "../format";
import {
  Card,
  Stat,
  Delta,
  Empty,
  Ticker,
  Segmented,
  Badge,
  useChartColors,
} from "../ui";
type Props = {
  status: MarketStatus | null;
  quotes: Map<string, Quote>;
  quoteList: Quote[];
  fetchedAt: string;
  symbols: string[];
  selected: string;
  setSelected: (s: string) => void;
  portfolio: Portfolio;
  store: PortfolioStore;
  snapshotTick: number;
  update: Update;
  onEdit: () => void;
  onAddSymbol: () => void;
  onSample: () => void;
};
const ranges = ["1D", "1W", "1M", "3M", "1Y"] as const;
type Range = (typeof ranges)[number];
export default function Overview(props: Props) {
  const { portfolio, quoteList, quotes, onEdit, onAddSymbol, onSample } = props;
  const v = useMemo(() => valuePortfolio(portfolio, quoteList), [portfolio, quoteList]);
  const missing = v.positions.filter((p) => p.value === null).map((p) => p.symbol);
  const prevEquity =
    v.equityValue !== null && v.dayChange !== null ? v.equityValue - v.dayChange : null;
  const contributed = v.capital;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            Overview {portfolio.isSample && <Badge kind="warn">Sample holdings</Badge>}
          </h1>
          <p>Your holdings, valued at the latest available quotes.</p>
        </div>
        <div className="page-actions">
          <button className="button" onClick={onAddSymbol}>
            <Plus size={16} aria-hidden /> Watch symbol
          </button>
          <button className="button primary" onClick={onEdit}>
            <Pencil size={15} aria-hidden /> Edit portfolio
          </button>
        </div>
      </div>
      <section className="kpis card" aria-label="Portfolio summary">
        <Stat
          label="Portfolio value"
          value={money(v.totalValue)}
          sub={
            v.totalValue === null ? (
              <span className="warn-text">No quote for {missing.join(", ")}</span>
            ) : (
              <>
                Holdings {money(v.equityValue, 0)} · Cash {money(portfolio.cash, 0)}
              </>
            )
          }
        />
        <Stat
          label="Today"
          value={signedMoney(v.dayChange)}
          valueTone={v.dayChange}
          sub={
            portfolio.positions.length ? (
              <>
                <Delta value={prevEquity ? (v.dayChange! / prevEquity) * 100 : null} /> on
                holdings
              </>
            ) : (
              "No holdings yet"
            )
          }
        />
        <Stat
          label="Unrealized P&L"
          value={signedMoney(v.unrealized)}
          valueTone={v.unrealized}
          sub={
            <>
              <Delta value={v.invested > 0 && v.unrealized !== null ? (v.unrealized / v.invested) * 100 : null} />{" "}
              on {money(v.invested, 0)} cost
            </>
          }
        />
        <Stat
          label="Return since start"
          value={signedMoney(v.sinceStart)}
          valueTone={v.sinceStart}
          sub={
            contributed > 0 ? (
              <>
                <Delta value={v.returnPercent} /> on {money(contributed, 0)} contributed
              </>
            ) : (
              "Add your starting amount to see a return"
            )
          }
        />
      </section>
      {!portfolio.positions.length && (
        <section className="card onboarding">
          <div>
            <h2>Add your portfolio</h2>
            <p>
              Enter each holding's shares and the total you paid for it, plus your cash and
              starting amount. Nothing is filled in for you.
            </p>
          </div>
          <div className="page-actions">
            <button className="button" onClick={onSample}>
              Try sample holdings
            </button>
            <button className="button primary" onClick={onEdit}>
              Add holdings
            </button>
          </div>
        </section>
      )}
      <div className="overview-grid">
        <ChartCard {...props} totalValue={v.totalValue} />
        <Allocation portfolio={portfolio} valuation={v} missing={missing} />
      </div>
      <Card
        title="Holdings"
        subtitle="Long stock positions · cost basis is the total paid per holding"
        actions={
          <button className="button ghost" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit
          </button>
        }
        flush
      >
        {portfolio.positions.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col" className="num">Shares</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col" className="num">Today</th>
                  <th scope="col" className="num">Market value</th>
                  <th scope="col" className="num">Cost basis</th>
                  <th scope="col" className="num">Unrealized</th>
                  <th scope="col" className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {v.positions.map((p) => (
                  <tr key={p.symbol} className={props.selected === p.symbol ? "selected" : ""}>
                    <th scope="row">
                      <button className="row-button" onClick={() => props.setSelected(p.symbol)}>
                        <Ticker symbol={p.symbol} name={p.quote?.name} />
                      </button>
                    </th>
                    <td className="num">{number(p.shares, 6)}</td>
                    <td className="num">{money(p.price)}</td>
                    <td className="num">
                      <Delta value={p.price === null ? null : p.quote?.changePercent} />
                    </td>
                    <td className="num strong">{money(p.value)}</td>
                    <td className="num">{money(p.costBasis)}</td>
                    <td className="num">
                      <Delta value={p.gain}>{signedMoney(p.gain)}</Delta>
                      <small className="cell-sub">
                        {p.gain !== null && p.costBasis > 0
                          ? percent((p.gain / p.costBasis) * 100)
                          : ""}
                      </small>
                    </td>
                    <td className="num">
                      {p.value !== null && v.totalValue
                        ? number((p.value / v.totalValue) * 100, 1) + "%"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td />
                  <td />
                  <td className="num">
                    <Delta value={v.dayChange}>{signedMoney(v.dayChange)}</Delta>
                  </td>
                  <td className="num strong">{money(v.equityValue)}</td>
                  <td className="num">{money(v.invested)}</td>
                  <td className="num">
                    <Delta value={v.unrealized}>{signedMoney(v.unrealized)}</Delta>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty title="No holdings yet">Your watchlist below still updates.</Empty>
        )}
      </Card>
      <Watchlist {...props} />
      <p className="footnote">
        Return since start = portfolio value − starting amount − net contributions, divided
        by contributed capital. It is a simple return, not time-weighted, and not a tax
        record. Editing holdings does not change cash.
      </p>
    </>
  );
}
function ChartCard({
  selected,
  quotes,
  portfolio,
  store,
  status,
  fetchedAt,
  snapshotTick,
  totalValue,
}: Props & { totalValue: number | null }) {
  const colors = useChartColors();
  const [mode, setMode] = useState<"stock" | "portfolio">("stock"),
    [range, setRange] = useState<Range>("1M"),
    [bars, setBars] = useState<Bar[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const quote = quotes.get(selected),
    minute = range === "1D" ? fetchedAt.slice(0, 16) : "";
  useEffect(() => {
    if (mode !== "stock" || !selected) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api<Bar[]>(`/history/${encodeURIComponent(selected)}?range=${range}`, {
      signal: abort.signal,
    })
      .then(setBars)
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          setBars([]);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [mode, selected, range, minute]);
  useEffect(() => {
    if (mode !== "portfolio" || !status) return;
    setError("");
    store
      .snapshots(portfolio, `${status.provider}:${status.recency}`)
      .then((rows) => setBars(rows.map((r) => ({ time: r.time, close: r.value }))))
      .catch((e: Error) => setError(e.message));
  }, [mode, store, portfolio, status, snapshotTick, fetchedAt.slice(0, 16)]);
  const first = bars[0]?.close,
    last = bars[bars.length - 1]?.close,
    rangeChange = first && last ? ((last - first) / first) * 100 : null,
    stroke =
      mode === "portfolio"
        ? colors.accent
        : tone(rangeChange) === "down"
          ? colors.down
          : tone(rangeChange) === "up"
            ? colors.up
            : colors.accent,
    intraday = mode === "portfolio" || range === "1D" || range === "1W";
  return (
    <Card
      className="chart-card"
      title={mode === "stock" ? <Ticker symbol={selected} name={quote?.name} /> : "Recorded portfolio value"}
      subtitle={
        mode === "stock"
          ? quote?.asOf
            ? `Last trade ${marketClock(quote.asOf)}`
            : "Select any holding or watchlist row to chart it"
          : "Recorded while Pulse is open · starts over when holdings or cash change"
      }
      actions={
        <Segmented
          label="Chart"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "stock", label: "Price" },
            { value: "portfolio", label: "My portfolio" },
          ]}
        />
      }
    >
      <div className="chart-toolbar">
        <div className="chart-figure">
          <strong>{mode === "stock" ? money(quote?.price) : money(totalValue)}</strong>
          {mode === "stock" ? (
            <span>
              <Delta value={quote?.price == null ? null : quote.changePercent} /> today
              {rangeChange !== null && range !== "1D" && (
                <>
                  {" · "}
                  <Delta value={rangeChange} /> {range}
                </>
              )}
            </span>
          ) : (
            <span>{bars.length} recorded points</span>
          )}
        </div>
        {mode === "stock" && (
          <Segmented
            label="Range"
            size="sm"
            value={range}
            onChange={setRange}
            options={ranges.map((r) => ({ value: r, label: r }))}
          />
        )}
      </div>
      <div className="chart-area">
        {bars.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bars} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(t: string) =>
                  range === "1D" && mode === "stock"
                    ? new Date(t).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : shortDate(t)
                }
                axisLine={false}
                tickLine={false}
                minTickGap={48}
                tick={{ fill: colors.axis, fontSize: 12 }}
              />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(n: number) => money(n, n >= 1000 ? 0 : 2)}
                width={72}
                axisLine={false}
                tickLine={false}
                tick={{ fill: colors.axis, fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  color: colors.text,
                }}
                labelStyle={{ color: colors.axis }}
                labelFormatter={(t) =>
                  new Date(String(t)).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    ...(intraday ? { hour: "numeric", minute: "2-digit" } : {}),
                  })
                }
                formatter={(n) => [money(Number(n)), mode === "stock" ? selected : "Portfolio"]}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={stroke}
                strokeWidth={2}
                fill="url(#chart-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty
            title={
              error
                ? "Chart unavailable"
                : mode === "portfolio"
                  ? "Your recorded history starts here"
                  : loading
                    ? "Loading chart…"
                    : "No price history"
            }
          >
            {error ||
              (mode === "portfolio"
                ? "Pulse records your portfolio's value about once a minute while it is open and every holding has a quote. Past performance is never backfilled."
                : "")}
          </Empty>
        )}
      </div>
    </Card>
  );
}
function Allocation({
  portfolio,
  valuation: v,
  missing,
}: {
  portfolio: Portfolio;
  valuation: ReturnType<typeof valuePortfolio>;
  missing: string[];
}) {
  const colors = useChartColors();
  const slices = v.positions
    .filter((p) => p.value !== null)
    .map((p) => ({ name: p.symbol, value: p.value! }));
  if (portfolio.cash > 0) slices.push({ name: "Cash", value: portfolio.cash });
  const total = slices.reduce((s, x) => s + x.value, 0);
  const colorOf = (name: string, i: number) =>
    name === "Cash" ? colors.axis : colors.series[i % colors.series.length];
  return (
    <Card title="Allocation" subtitle="Share of market value, including cash">
      {slices.length ? (
        <div className="allocation">
          <div className="donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={slices.length > 1 ? 2 : 0}
                  dataKey="value"
                  stroke="none"
                  isAnimationActive={false}
                >
                  {slices.map((s, i) => (
                    <Cell key={s.name} fill={colorOf(s.name, i)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <small>{missing.length ? "Partial" : "Total"}</small>
              <b>{money(total, 0)}</b>
            </div>
          </div>
          <ul className="legend">
            {slices.map((s, i) => (
              <li key={s.name}>
                <i style={{ background: colorOf(s.name, i) }} aria-hidden />
                <span>{s.name}</span>
                <b>{number((s.value / total) * 100, 1)}%</b>
                <small>{money(s.value, 0)}</small>
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="warn-text small">
              Excludes {missing.join(", ")}: no quote, so weights are partial.
            </p>
          )}
        </div>
      ) : (
        <Empty title="Nothing allocated yet">Holdings and cash appear here.</Empty>
      )}
    </Card>
  );
}
function Watchlist({ portfolio, quotes, selected, setSelected, update, onAddSymbol }: Props) {
  const [busy, setBusy] = useState("");
  return (
    <Card
      title={
        <>
          Watchlist <span className="count">{portfolio.watchlist.length}</span>
        </>
      }
      subtitle="Delayed quotes for symbols you follow"
      actions={
        <button className="button ghost" onClick={onAddSymbol}>
          <Plus size={15} aria-hidden /> Add
        </button>
      }
      flush
    >
      {portfolio.watchlist.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="num">Price</th>
                <th scope="col" className="num">Change</th>
                <th scope="col" className="num">Today</th>
                <th scope="col" className="num hide-sm">Last trade</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {portfolio.watchlist.map((symbol) => {
                const q = quotes.get(symbol),
                  priced = q?.price != null;
                return (
                  <tr key={symbol} className={selected === symbol ? "selected" : ""}>
                    <th scope="row">
                      <button className="row-button" onClick={() => setSelected(symbol)}>
                        <Ticker symbol={symbol} name={q?.name} />
                      </button>
                    </th>
                    <td className="num strong">{priced ? money(q!.price) : "No quote"}</td>
                    <td className="num">
                      <Delta value={priced ? q!.change : null}>
                        {priced ? signedMoney(q!.change) : "—"}
                      </Delta>
                    </td>
                    <td className="num">
                      <Delta value={priced ? q!.changePercent : null} />
                    </td>
                    <td className="num muted hide-sm">
                      {q?.source === "Simulated" ? "Simulated" : marketClock(q?.asOf)}
                    </td>
                    <td className="row-end">
                      <button
                        className="icon-button"
                        aria-label={`Stop watching ${symbol}`}
                        title={`Stop watching ${symbol}`}
                        disabled={busy === symbol}
                        onClick={() => {
                          setBusy(symbol);
                          void update((p) => ({
                            ...p,
                            watchlist: p.watchlist.filter((s) => s !== symbol),
                          }))
                            .catch(() => {})
                            .finally(() => setBusy(""));
                        }}
                      >
                        <X size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Your watchlist is empty" action={
          <button className="button" onClick={onAddSymbol}>Add a symbol</button>
        } />
      )}
    </Card>
  );
}
