import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ArrowRight } from "lucide-react";
import type {
  MarketStatus,
  OptionChain,
  OptionContract,
  Quote,
} from "../../shared/types";
import { nearMoneyIV } from "../../shared/types";
import { daysToExpiry } from "../../shared/pricing";
import { api } from "../backend";
import { Card, Stat, Empty, Notice, Segmented, Delta } from "../ui";
import { money, number, clock, expiryLabel } from "../format";
type Props = {
  status: MarketStatus | null;
  symbols: string[];
  selected: string;
  setSelected: (s: string) => void;
  quotes: Map<string, Quote>;
  chooseContract: (c: OptionContract) => void;
};
const NEAR = 10; // strikes either side of the underlying price
export const midpoint = (c: Pick<OptionContract, "bid" | "ask">) =>
  c.bid !== null && c.ask !== null && c.bid >= 0 && c.ask > 0 && c.ask >= c.bid
    ? (c.bid + c.ask) / 2
    : null;
export default function Options({
  status,
  symbols,
  selected,
  setSelected,
  quotes,
  chooseContract,
}: Props) {
  const [chain, setChain] = useState<OptionChain | null>(null),
    [expiry, setExpiry] = useState(""),
    [kind, setKind] = useState<"all" | "call" | "put">("all"),
    [scope, setScope] = useState<"near" | "all">("near"),
    [sort, setSort] = useState<"strike" | "volume" | "oi">("strike"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refreshKey, setRefreshKey] = useState(0),
    [choices, setChoices] = useState<{ symbol: string; expiries: string[] }>({
      symbol: selected,
      expiries: [],
    });
  useEffect(() => {
    setExpiry("");
    setChain(null);
    setChoices({ symbol: selected, expiries: [] });
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
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
        setChoices((prev) => ({
          symbol: selected,
          expiries: [
            ...new Set([...(prev.symbol === selected ? prev.expiries : []), ...c.expiries]),
          ].sort(),
        }));
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          setChain(null);
          setError(e.message);
        }
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
  const quote = quotes.get(selected),
    spot = quote?.price ?? null,
    contracts = chain?.contracts || [],
    shownExpiry = expiry || contracts[0]?.expiry || "",
    expiries = choices.symbol === selected ? choices.expiries : chain?.expiries || [];
  const strikes = useMemo(
    () => [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b),
    [chain],
  );
  const atm =
    spot === null || !strikes.length
      ? null
      : strikes.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best));
  const nearSet = useMemo(() => {
    if (atm === null) return null;
    const i = strikes.indexOf(atm);
    return new Set(strikes.slice(Math.max(0, i - NEAR), i + NEAR + 1));
  }, [strikes, atm]);
  const rows = contracts
    .filter((c) => kind === "all" || c.type === kind)
    .filter((c) => scope === "all" || !nearSet || nearSet.has(c.strike))
    .sort((a, b) =>
      sort === "volume"
        ? (b.volume ?? -1) - (a.volume ?? -1)
        : sort === "oi"
          ? (b.openInterest ?? -1) - (a.openInterest ?? -1)
          : a.strike - b.strike || a.type.localeCompare(b.type),
    );
  const sum = (type: "call" | "put", field: "volume" | "openInterest") => {
    const list = contracts.filter((c) => c.type === type);
    return chain && list.length && list.every((c) => c[field] !== null)
      ? list.reduce((s, c) => s + c[field]!, 0)
      : null;
  };
  const callVolume = sum("call", "volume"),
    putVolume = sum("put", "volume"),
    callOI = sum("call", "openInterest"),
    putOI = sum("put", "openInterest"),
    atmIV = nearMoneyIV(contracts, spot),
    hasQuoteTimes = contracts.some((c) => c.asOf);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Options</h1>
          <p>Delayed option chains with volume, open interest and implied volatility.</p>
        </div>
        <div className="page-actions">
          <button
            className="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden /> Refresh
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="fields">
          <label className="field inline">
            <span>Underlying</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {[...new Set([selected, ...symbols])].filter(Boolean).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Expiration</span>
            <select
              value={shownExpiry}
              disabled={!expiries.length}
              onChange={(e) => {
                setChain(null);
                setExpiry(e.target.value);
              }}
            >
              {!expiries.length && <option value="">—</option>}
              {expiries.map((e) => (
                <option key={e} value={e}>
                  {expiryLabel(e, daysToExpiry(e))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="fields">
          <Segmented
            label="Contract type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "All" },
              { value: "call", label: "Calls" },
              { value: "put", label: "Puts" },
            ]}
          />
          <Segmented
            label="Strikes"
            value={scope}
            onChange={setScope}
            options={[
              { value: "near", label: `Near money` },
              { value: "all", label: "All strikes" },
            ]}
          />
          <label className="field inline">
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="strike">Sort: strike</option>
              <option value="volume">Sort: volume</option>
              <option value="oi">Sort: open interest</option>
            </select>
          </label>
        </div>
      </div>
      <section className="kpis card" aria-label="Chain summary">
        <Stat
          label={`${selected || "Underlying"} price`}
          value={money(spot)}
          sub={<Delta value={spot === null ? null : quote?.changePercent} />}
        />
        <Stat
          label="Near-the-money IV"
          value={atmIV == null ? "—" : number(atmIV * 100, 1) + "%"}
          sub={spot === null ? "Needs an underlying price" : "Call/put average at the nearest strike"}
        />
        <Stat
          label="Volume · calls / puts"
          value={`${number(callVolume, 0)} / ${number(putVolume, 0)}`}
          sub={
            callVolume && putVolume !== null
              ? `Put/call ratio ${number(putVolume / callVolume, 2)}`
              : "This expiry"
          }
        />
        <Stat
          label="Open interest · calls / puts"
          value={`${number(callOI, 0)} / ${number(putOI, 0)}`}
          sub="This expiry, as of the prior close"
        />
      </section>
      <Notice>
        Volume and open interest measure activity. They do not show who bought or sold,
        whether trades opened or closed positions, or anyone's intent.
      </Notice>
      {chain?.truncated && (
        <Notice kind="warn">
          This chain is partial: the provider's page limit was reached. Totals describe only
          the contracts shown.
        </Notice>
      )}
      <Card
        title={`${selected} · ${shownExpiry ? expiryLabel(shownExpiry, daysToExpiry(shownExpiry)) : "chain"}`}
        subtitle={
          chain
            ? `${chain.source}${chain.snapshotGeneratedAt ? ` · snapshot ${clock(chain.snapshotGeneratedAt, true)}` : ""} · refreshes every minute`
            : "Loading provider…"
        }
        flush
      >
        {error ? (
          <div className="pad">
            <Notice kind="error">{error}</Notice>
          </div>
        ) : loading && !chain ? (
          <Empty title="Loading the chain…" />
        ) : !rows.length ? (
          <Empty title="No contracts">Try another symbol or expiration.</Empty>
        ) : (
          <div className="table-scroll tall">
            <table className="data-table chain">
              <thead>
                <tr>
                  <th scope="col" className="num">Strike</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">Bid</th>
                  <th scope="col" className="num">Ask</th>
                  <th scope="col" className="num">Mid</th>
                  <th scope="col" className="num">IV</th>
                  <th scope="col" className="num">Volume</th>
                  <th scope="col" className="num">Open int.</th>
                  <th scope="col" className="num">Delta</th>
                  {hasQuoteTimes && <th scope="col" className="num">Quote</th>}
                  <th scope="col">
                    <span className="sr-only">Price this contract</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const itm =
                    spot !== null && (c.type === "call" ? c.strike < spot : c.strike > spot);
                  return (
                    <tr
                      key={c.ticker}
                      className={`${itm ? "itm" : ""} ${c.strike === atm ? "atm" : ""}`}
                    >
                      <th scope="row" className="num strong">
                        {money(c.strike)}
                      </th>
                      <td>
                        <span className={`kind ${c.type}`}>{c.type === "call" ? "Call" : "Put"}</span>
                      </td>
                      <td className="num">{money(c.bid)}</td>
                      <td className="num">{money(c.ask)}</td>
                      <td className="num">{money(midpoint(c))}</td>
                      <td className="num">{c.iv !== null ? number(c.iv * 100, 1) + "%" : "—"}</td>
                      <td className="num">{number(c.volume, 0)}</td>
                      <td className="num">{number(c.openInterest, 0)}</td>
                      <td className="num">{number(c.delta, 3)}</td>
                      {hasQuoteTimes && <td className="num muted">{clock(c.asOf)}</td>}
                      <td className="row-end">
                        <button
                          className="button ghost small"
                          onClick={() => chooseContract(c)}
                          aria-label={`Price ${selected} ${c.strike} ${c.type} in the pricing lab`}
                        >
                          Price <ArrowRight size={14} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="footnote">
        Shaded rows are in the money; the outlined row is the strike nearest the underlying.
        IV is annualized and comes from the provider, which may use a different model than
        your BSM engine. {status?.provider === "demo" && "This chain is simulated."}
      </p>
    </>
  );
}
