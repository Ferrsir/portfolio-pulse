import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { MarketStatus, OptionContract, Quote } from "../../shared/types";
import {
  priceOption,
  solveIV,
  daysToExpiry,
  inputProblem,
  TREE_STEPS,
  type PricingInput,
} from "../../shared/pricing";
import { Card, Notice, Segmented, Badge, useChartColors } from "../ui";
import { money, number, significant, marketClock, expiryLabel } from "../format";
import { midpoint, IMPLAUSIBLE_IV } from "../optionMath";
type Props = {
  status: MarketStatus | null;
  symbols: string[];
  selected: string;
  setSelected: (s: string) => void;
  quotes: Map<string, Quote>;
  contract: OptionContract | null;
  clearContract: () => void;
};
type SpotSource = "quote" | "manual";
/** Provider IV worth copying: present, positive and not an extreme artefact. */
const usableIV = (c: OptionContract | null) =>
  c?.iv != null && c.iv > 0 && c.iv <= IMPLAUSIBLE_IV ? c.iv : null;
const niceStrike = (spot: number) => {
  const step = spot >= 200 ? 5 : spot >= 50 ? 1 : 0.5;
  return Math.round(spot / step) * step;
};
export default function Pricing({
  symbols,
  selected,
  setSelected,
  quotes,
  contract,
  clearContract,
}: Props) {
  const quote = quotes.get(selected),
    quotedSpot = quote?.price ?? null;
  const [input, setInput] = useState<PricingInput>(() => ({
      spot: quotedSpot ?? NaN,
      strike: contract?.strike ?? (quotedSpot ? niceStrike(quotedSpot) : NaN),
      days: contract ? daysToExpiry(contract.expiry) : 30,
      rate: 0.04,
      iv: usableIV(contract) ?? 0.3,
      dividend: 0,
      type: contract?.type || "call",
      multiplier: contract?.multiplier || 100,
    })),
    [spotSource, setSpotSource] = useState<SpotSource>("quote"),
    [marketPremium, setMarketPremium] = useState<number | "">(() =>
      contract ? (midpoint(contract) ?? "") : "",
    );
  // A newly chosen chain contract replaces the contract fields (not rate, dividend or your IV
  // unless the provider supplied one).
  useEffect(() => {
    if (!contract) return;
    setInput((p) => ({
      ...p,
      strike: contract.strike,
      days: daysToExpiry(contract.expiry),
      iv: usableIV(contract) ?? p.iv,
      type: contract.type,
      multiplier: contract.multiplier,
    }));
    setMarketPremium(midpoint(contract) ?? "");
  }, [contract]);
  // Spot follows the selected stock's quote until you type your own.
  useEffect(() => {
    if (spotSource !== "quote") return;
    setInput((p) => ({
      ...p,
      spot: quotedSpot ?? NaN,
      strike: Number.isFinite(p.strike) || quotedSpot === null ? p.strike : niceStrike(quotedSpot),
    }));
  }, [quotedSpot, selected, spotSource]);
  const problem = inputProblem(input);
  const result = useMemo(() => (problem ? null : priceOption(input)), [input, problem]);
  const marketIV = useMemo(
    () =>
      marketPremium === "" || problem || input.days <= 0
        ? null
        : solveIV(Number(marketPremium), input),
    [marketPremium, input, problem],
  );
  const marketIVValid = marketIV !== null && Number.isFinite(marketIV);
  const chart = useMemo(() => {
    if (problem) return [];
    const top = Math.max(150, ((Math.max(input.iv, marketIVValid ? marketIV! : 0) * 100) * 1.25)),
      step = top > 300 ? 10 : top > 150 ? 5 : 2.5;
    return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => {
      const pct = i * step;
      return { iv: pct, premium: priceOption({ ...input, iv: pct / 100 }).premium };
    });
  }, [input, problem, marketIV, marketIVValid]);
  const colors = useChartColors();
  const set = (key: keyof PricingInput, value: number) =>
    setInput((p) => ({ ...p, [key]: value }));
  const field = (
    key: "spot" | "strike" | "days" | "rate" | "iv" | "dividend" | "multiplier",
    label: string,
    unit: string,
    scale = 1,
    extra: { min?: number; max?: number; hint?: string } = {},
  ) => (
    <label className="field">
      <span>{label}</span>
      <span className="with-unit">
        {unit === "$" && <i>$</i>}
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={extra.min}
          max={extra.max}
          value={Number.isFinite(input[key]) ? Number((input[key] * scale).toFixed(6)) : ""}
          onChange={(e) => {
            if (key === "spot") setSpotSource("manual");
            if (contract && ["strike", "days", "multiplier"].includes(key)) clearContract();
            set(key, e.target.value === "" ? NaN : Number(e.target.value) / scale);
          }}
        />
        {unit !== "$" && <i>{unit}</i>}
      </span>
      {extra.hint && <small>{extra.hint}</small>}
    </label>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pricing lab</h1>
          <p>Your Black–Scholes–Merton engine with Greeks, IV solving and an American comparison.</p>
        </div>
        <div className="page-actions">
          <a
            className="button ghost"
            href="https://github.com/Ferrsir/options-pricer"
            target="_blank"
            rel="noreferrer"
          >
            Model source <ExternalLink size={14} aria-hidden />
          </a>
        </div>
      </div>
      {contract && (
        <Notice
          action={
            <button className="button ghost small" onClick={clearContract}>
              <X size={14} aria-hidden /> Unlink
            </button>
          }
        >
          Linked to <b>{selected} {money(contract.strike)} {contract.type}</b>, expiring{" "}
          {expiryLabel(contract.expiry, daysToExpiry(contract.expiry))} (4:00 PM ET).{" "}
          {usableIV(contract) !== null
            ? `Provider IV ${number(contract.iv! * 100, 2)}% was copied into your IV.`
            : contract.iv
              ? `Provider IV ${number(contract.iv * 100, 0)}% looks unreliable, so your IV is unchanged.`
              : "The provider gave no IV, so your IV is unchanged."}
        </Notice>
      )}
      <div className="pricing-grid">
        <Card title="Inputs" subtitle="European BSM · ACT/365 · continuous rate and dividend yield">
          <div className="form-stack">
            <div className="field-row">
              <label className="field">
                <span>Stock</span>
                <select
                  value={selected}
                  onChange={(e) => {
                    clearContract();
                    setSpotSource("quote");
                    setInput((p) => ({ ...p, strike: NaN }));
                    setSelected(e.target.value);
                  }}
                >
                  {[...new Set([selected, ...symbols])].filter(Boolean).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <Segmented
                label="Option type"
                value={input.type}
                onChange={(t) => {
                  if (contract) clearContract();
                  setInput((p) => ({ ...p, type: t }));
                }}
                options={[
                  { value: "call", label: "Call" },
                  { value: "put", label: "Put" },
                ]}
              />
            </div>
            <div className="form-grid">
              {field("spot", "Stock price", "$", 1, { min: 0 })}
              {field("strike", "Strike", "$", 1, { min: 0 })}
            </div>
            <p className="field-note">
              {spotSource === "quote" ? (
                quotedSpot !== null ? (
                  <>
                    Using {selected}'s quote
                    {quote?.asOf ? ` (last trade ${marketClock(quote.asOf)})` : ""}.
                  </>
                ) : (
                  <span className="warn-text">Waiting for a {selected} quote. You can type a price.</span>
                )
              ) : (
                <>
                  Using your own stock price.{" "}
                  <button
                    className="link-button"
                    disabled={quotedSpot === null}
                    onClick={() => setSpotSource("quote")}
                  >
                    Use the latest quote
                  </button>
                </>
              )}
            </p>
            <div className="form-grid">
              {field("days", "Time to expiry", "days", 1, { min: 0 })}
              {field("iv", "Your volatility (IV)", "%", 100, { min: 0, max: 500 })}
              {field("rate", "Risk-free rate", "%", 100, { min: -100, max: 100 })}
              {field("dividend", "Dividend yield", "%", 100, { min: 0, max: 100 })}
              {field("multiplier", "Contract multiplier", "shares", 1, { min: 1 })}
            </div>
            <label className="field">
              <span>
                Explore volatility <b>{Number.isFinite(input.iv) ? number(input.iv * 100, 1) + "%" : "—"}</b>
              </span>
              <input
                type="range"
                min="1"
                max="150"
                step="0.5"
                aria-label="Explore volatility"
                value={Number.isFinite(input.iv) ? Math.min(150, Math.max(1, input.iv * 100)) : 30}
                onChange={(e) => set("iv", Number(e.target.value) / 100)}
              />
            </label>
            <p className="field-note">
              Rate and dividend yield are your assumptions, not a fitted curve.
            </p>
          </div>
        </Card>
        <div className="pricing-results">
          {problem ? (
            <Notice kind="warn">{problem}</Notice>
          ) : (
            result && (
              <>
                <Card className="premium-card">
                  <div className="premium">
                    <span className="stat-label">Model premium · {input.type}</span>
                    <strong>
                      {money(result.premium)}
                      <small>/ share</small>
                    </strong>
                    <span className="muted">
                      {money(result.contractPremium)} per {number(input.multiplier, 4)}-share contract
                    </span>
                  </div>
                  <dl className="facts">
                    <div>
                      <dt>Intrinsic value</dt>
                      <dd>{money(result.intrinsic)}</dd>
                    </div>
                    <div>
                      <dt>Time value</dt>
                      <dd>{money(Math.max(0, result.premium - result.intrinsic))}</dd>
                    </div>
                    <div>
                      <dt>American (CRR {TREE_STEPS})</dt>
                      <dd>{money(result.american)}</dd>
                    </div>
                    <div>
                      <dt title="American minus European, both on the same tree">Early-exercise value</dt>
                      <dd>{money(result.earlyExercise, 4)}</dd>
                    </div>
                  </dl>
                  {result.american === null && input.days > 0 && input.iv > 0 && (
                    <p className="field-note">
                      The tree is unavailable at this volatility: CRR needs σ above |r − q|·√Δt.
                    </p>
                  )}
                </Card>
                <div className="greeks">
                  {(
                    [
                      ["Delta", result.delta, "per $1 in the stock"],
                      ["Gamma", result.gamma, "delta change per $1"],
                      ["Theta", result.thetaDay, "$ per calendar day"],
                      ["Vega", result.vegaPoint, "$ per 1 IV point"],
                      ["Rho", result.rhoPoint, "$ per 1 rate point"],
                    ] as const
                  ).map(([label, value, note]) => (
                    <div className="greek" key={label}>
                      <span className="stat-label">{label}</span>
                      <b>{significant(value)}</b>
                      <small>{note}</small>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
          <Card
            title="Compare with a market premium"
            subtitle="Per share. A midpoint is not a guaranteed fill."
          >
            <div className="compare">
              <label className="field">
                <span>Market premium</span>
                <span className="with-unit">
                  <i>$</i>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={marketPremium === "" ? "" : Number(marketPremium.toFixed(6))}
                    onChange={(e) =>
                      setMarketPremium(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  />
                </span>
              </label>
              <dl className="facts">
                <div>
                  <dt>Market − model</dt>
                  <dd>
                    {marketPremium === "" || !result
                      ? "—"
                      : money(Number(marketPremium) - result.premium)}
                  </dd>
                </div>
                <div>
                  <dt>Market-implied IV</dt>
                  <dd>
                    {marketIV === null
                      ? "—"
                      : marketIVValid
                        ? number(marketIV * 100, 2) + "%"
                        : "No solution"}
                  </dd>
                </div>
                <div>
                  <dt>Your IV</dt>
                  <dd>{Number.isFinite(input.iv) ? number(input.iv * 100, 2) + "%" : "—"}</dd>
                </div>
              </dl>
            </div>
            {marketIV !== null && !marketIVValid && (
              <p className="field-note warn-text">
                No BSM volatility between 0.01% and 500% reproduces this premium. Check that it
                lies between the option's no-arbitrage bounds.
              </p>
            )}
            {marketIVValid && (
              <button
                className="button small"
                onClick={() => set("iv", marketIV!)}
                disabled={Math.abs(marketIV! - input.iv) < 1e-9}
              >
                Use market IV as my IV
              </button>
            )}
          </Card>
          {chart.length > 0 && (
            <Card
              title="Premium across volatility"
              subtitle="All other inputs held constant · dashed: your IV · solid: market-implied IV"
            >
              <div className="chart-area short">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={colors.grid} vertical={false} />
                    <XAxis
                      dataKey="iv"
                      type="number"
                      domain={[0, "dataMax"]}
                      tickFormatter={(v: number) => v + "%"}
                      tick={{ fill: colors.axis, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      width={64}
                      tickFormatter={(v: number) => money(v, v >= 100 ? 0 : 2)}
                      tick={{ fill: colors.axis, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        color: colors.text,
                      }}
                      labelStyle={{ color: colors.axis }}
                      formatter={(v) => [money(Number(v)), "Model premium"]}
                      labelFormatter={(v) => `IV ${v}%`}
                    />
                    <Line
                      type="monotone"
                      dataKey="premium"
                      stroke={colors.accent}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      x={input.iv * 100}
                      stroke={colors.axis}
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                    {marketIVValid && (
                      <ReferenceLine
                        x={marketIV! * 100}
                        stroke={colors.series[1]}
                        ifOverflow="extendDomain"
                      />
                    )}
                    {marketPremium !== "" && (
                      <ReferenceLine
                        y={Number(marketPremium)}
                        stroke={colors.series[1]}
                        strokeOpacity={0.5}
                        ifOverflow="extendDomain"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="legend inline">
                <Badge>Your IV {number(input.iv * 100, 1)}%</Badge>
                {marketIVValid && <Badge kind="accent">Market IV {number(marketIV! * 100, 1)}%</Badge>}
              </div>
            </Card>
          )}
        </div>
      </div>
      <p className="footnote">
        BSM prices a European option with constant volatility and a continuous dividend yield.
        US stock options are American, so the CRR tree estimates the early-exercise value
        (American minus European on the same {TREE_STEPS}-step tree). A model value depends on
        its assumptions and is not an executable price.
      </p>
    </>
  );
}
