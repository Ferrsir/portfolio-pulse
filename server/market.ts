import type {
  Quote,
  Bar,
  NewsItem,
  OptionContract,
  OptionChain,
  MarketStatus,
} from "../shared/types.js";
import { bsmPrice, bsmGreeks } from "../shared/vendor/pricing.js";
import { daysToExpiry } from "../shared/pricing.js";
const names: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  TSLA: "Tesla",
  SPY: "SPDR S&P 500 ETF",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  META: "Meta Platforms",
};
const demoPrices: Record<string, number> = {
  AAPL: 228.6,
  MSFT: 432.9,
  NVDA: 138.4,
  TSLA: 264.2,
  SPY: 583.8,
  AMZN: 194.2,
  GOOGL: 172.5,
  META: 581.4,
};
const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
const nullable = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
// A traded stock never prices at or below zero; such values are provider placeholders.
const positive = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
const timestamp = (x: unknown) => {
  if (typeof x !== "number" || x <= 0) return null;
  const ms = x > 1e16 ? x / 1e6 : x > 1e13 ? x / 1000 : x < 1e11 ? x * 1000 : x;
  return new Date(ms).toISOString();
};
// Cboe's top-level `timestamp` is snapshot generation time in UTC without a zone suffix.
export const cboeGeneratedAt = (x: unknown) => {
  const match =
    typeof x === "string" &&
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(x.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
// Expiries seen per underlying, so a filtered Massive request keeps earlier choices. Bounded; no extra requests.
const expiryChoices = new Map<string, { until: number; expiries: string[] }>();
function rememberExpiries(symbol: string, found: string[]) {
  const today = new Date().toISOString().slice(0, 10),
    known = expiryChoices.get(symbol),
    previous = known && known.until > Date.now() ? known.expiries : [];
  const expiries = [...new Set([...previous, ...found])]
    .filter((e) => e >= today)
    .sort()
    .slice(0, 400);
  expiryChoices.delete(symbol);
  if (expiryChoices.size >= 200)
    expiryChoices.delete(expiryChoices.keys().next().value!);
  expiryChoices.set(symbol, { until: Date.now() + 6 * 3600000, expiries });
  return expiries;
}
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<any>>();
async function cached<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing && existing.until > Date.now()) return existing.value as T;
  if (pending.has(key)) return pending.get(key)!;
  const promise = fn()
    .then((value) => {
      if (cache.size > 300) cache.clear();
      cache.set(key, { until: Date.now() + ttl, value });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
async function getJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (PortfolioPulse; personal dashboard)",
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Market provider returned ${response.status}. ${response.status === 403 ? "Check data entitlements." : response.status === 429 ? "Rate limit reached; wait before refreshing." : "Try again later."}`,
    );
  return response.json() as Promise<any>;
}
export function marketStatus(): MarketStatus {
  const provider = process.env.MARKET_PROVIDER || "demo";
  return {
    provider,
    recency:
      provider === "demo"
        ? "Simulated"
        : provider === "yahoo"
          ? "Delayed / unofficial"
          : process.env.MARKET_DATA_RECENCY === "realtime"
            ? "Real-time entitlement · polled"
            : "Delayed entitlement · polled",
    pollMs: provider === "yahoo" ? 60000 : 15000,
    configured: provider !== "massive" || Boolean(process.env.MASSIVE_API_KEY),
    model: "Ferrsir/options-pricer · 68c3636",
  };
}
function massive(path: string, params: Record<string, string> = {}) {
  if (!process.env.MASSIVE_API_KEY)
    throw new Error("Add MASSIVE_API_KEY to .env and restart to use Massive.");
  const url = new URL(path, "https://api.massive.com");
  if (url.origin !== "https://api.massive.com")
    throw new Error("Invalid provider pagination URL.");
  url.searchParams.delete("apiKey");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return getJson(url.toString(), {
    Authorization: `Bearer ${process.env.MASSIVE_API_KEY}`,
  });
}
function demoQuote(symbol: string): Quote {
  const base = demoPrices[symbol] || 50 + (hash(symbol) % 250),
    wave = Math.sin(Date.now() / 45000 + hash(symbol)) * 0.003;
  const price = Number((base * (1 + wave)).toFixed(2));
  const previousClose = base / (1 + ((hash(symbol) % 9) - 2) / 100);
  return {
    symbol,
    name: names[symbol] || `${symbol} · simulated`,
    price,
    previousClose,
    change: price - previousClose,
    changePercent: (price / previousClose - 1) * 100,
    asOf: new Date().toISOString(),
    source: "Simulated",
  };
}
async function yahooChart(symbol: string, range = "1d", interval = "5m") {
  return cached(`yahoo:${symbol}:${range}`, 60000, async () => {
    const data = await getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
    );
    const chart = data.chart?.result?.[0];
    if (!chart) throw new Error(`No Yahoo data for ${symbol}.`);
    return chart;
  });
}
export async function quotes(symbols: string[]): Promise<Quote[]> {
  const provider = marketStatus().provider;
  if (provider === "demo") return symbols.map(demoQuote);
  if (provider === "yahoo")
    return Promise.all(
      symbols.map(async (symbol) => {
        try {
          const chart = await yahooChart(symbol),
            m = chart.meta,
            price = positive(m.regularMarketPrice),
            previousClose = positive(m.chartPreviousClose ?? m.previousClose);
          return {
            symbol,
            name: m.longName || m.shortName || names[symbol] || symbol,
            price,
            previousClose,
            change:
              price !== null && previousClose !== null
                ? price - previousClose
                : null,
            changePercent:
              price !== null && previousClose
                ? 100 * (price / previousClose - 1)
                : null,
            asOf: timestamp(m.regularMarketTime),
            source: "Yahoo · unofficial / delayed",
          };
        } catch {
          return {
            symbol,
            name: names[symbol] || symbol,
            price: null,
            previousClose: null,
            change: null,
            changePercent: null,
            asOf: null,
            source: "Yahoo unavailable",
          };
        }
      }),
    );
  return cached(`quotes:${symbols.join(",")}`, 12000, async () => {
    const data = await massive(
      "/v2/snapshot/locale/us/markets/stocks/tickers",
      { tickers: symbols.join(",") },
    );
    const map = new Map<string, any>(
      (data.tickers || []).map((q: any) => [q.ticker, q]),
    );
    return symbols.map((symbol) => {
      const q = map.get(symbol),
        // After the provider's overnight reset, minute/day bars read 0: skip them, never value at $0.
        price =
          positive(q?.lastTrade?.p) ?? positive(q?.min?.c) ?? positive(q?.day?.c),
        previousClose = positive(q?.prevDay?.c);
      return {
        symbol,
        name: names[symbol] || symbol,
        price,
        previousClose,
        change:
          price !== null && previousClose !== null
            ? price - previousClose
            : null,
        changePercent:
          price !== null && previousClose
            ? 100 * (price / previousClose - 1)
            : null,
        asOf: timestamp(q?.lastTrade?.t ?? q?.min?.t ?? q?.updated),
        source: "Massive",
      };
    });
  });
}
export async function history(symbol: string, range: string): Promise<Bar[]> {
  const config: Record<
    string,
    { days: number; multiplier: number; span: string; interval: string }
  > = {
    "1D": { days: 1, multiplier: 5, span: "minute", interval: "5m" },
    "1W": { days: 7, multiplier: 30, span: "minute", interval: "30m" },
    "1M": { days: 30, multiplier: 1, span: "day", interval: "1d" },
    "3M": { days: 90, multiplier: 1, span: "day", interval: "1d" },
    "1Y": { days: 365, multiplier: 1, span: "day", interval: "1d" },
  };
  const c = Object.hasOwn(config, range) ? config[range] : config["1M"],
    provider = marketStatus().provider;
  if (provider === "demo") {
    const current = demoQuote(symbol).price!,
      n = range === "1D" ? 78 : Math.min(c.days, 180),
      seed = hash(symbol);
    return Array.from({ length: n }, (_, i) => ({
      time: new Date(
        Date.now() - ((n - 1 - i) * c.days * 86400000) / n,
      ).toISOString(),
      close:
        current *
        (0.96 +
          (0.04 * i) / (n - 1) +
          0.007 * Math.sin(i * 0.6 + seed) +
          0.004 * Math.cos(i * 1.4)),
    }));
  }
  if (provider === "yahoo") {
    const chart = await yahooChart(
      symbol,
      { "1D": "1d", "1W": "5d", "1M": "1mo", "3M": "3mo", "1Y": "1y" }[range] ||
        "1mo",
      c.interval,
    );
    return (chart.timestamp || [])
      .map((t: number, i: number) => ({
        time: new Date(t * 1000).toISOString(),
        close: chart.indicators?.quote?.[0]?.close?.[i],
      }))
      .filter((x: Bar) => Number.isFinite(x.close) && x.close > 0);
  }
  return cached(`bars:${symbol}:${range}`, 60000, async () => {
    const end = new Date().toISOString().slice(0, 10),
      start = new Date(Date.now() - c.days * 86400000)
        .toISOString()
        .slice(0, 10);
    const data = await massive(
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${c.multiplier}/${c.span}/${start}/${end}`,
      { adjusted: "true", sort: "asc", limit: "50000" },
    );
    return (data.results || [])
      .map((b: any) => ({ time: new Date(b.t).toISOString(), close: b.c }))
      .filter((b: Bar) => Number.isFinite(b.close) && b.close > 0);
  });
}
export async function news(symbols: string[]): Promise<NewsItem[]> {
  const provider = marketStatus().provider;
  if (provider === "demo")
    return symbols.flatMap((symbol, i) => [
      {
        id: `${symbol}-1`,
        title: `${names[symbol] || symbol}: an example earnings headline`,
        publisher: "Demo newsroom",
        url: null,
        publishedAt: new Date(Date.now() - i * 3600000 - 1200000).toISOString(),
        symbols: [symbol],
        description:
          "Simulated article for previewing your news feed. Connect a provider to read real headlines.",
      },
      {
        id: `${symbol}-2`,
        title: `What investors are watching in ${symbol} this week`,
        publisher: "Demo market briefing",
        url: null,
        publishedAt: new Date(Date.now() - i * 3600000 - 8000000).toISOString(),
        symbols: [symbol],
        description:
          "This sample is fictional and does not describe a real market event.",
      },
    ]);
  return cached(`news:${symbols.join(",")}`, 300000, async () => {
    const groups = await Promise.all(
      symbols.map(async (symbol) => {
        if (provider === "yahoo") {
          const d = await getJson(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=6`,
          );
          return (d.news || []).map((n: any) => ({
            id: n.uuid,
            title: n.title,
            publisher: n.publisher,
            url: n.link,
            publishedAt: new Date(n.providerPublishTime * 1000).toISOString(),
            symbols: n.relatedTickers || [symbol],
            description: "",
          }));
        }
        const d = await massive("/v2/reference/news", {
          ticker: symbol,
          limit: "6",
          sort: "published_utc",
          order: "desc",
        });
        return (d.results || []).map((n: any) => ({
          id: n.id,
          title: n.title,
          publisher: n.publisher?.name || "News",
          url: n.article_url,
          publishedAt: n.published_utc,
          symbols: n.tickers || [symbol],
          description: (n.description || "").slice(0, 280),
        }));
      }),
    );
    return [
      ...new Map<string, NewsItem>(
        groups.flat().map((n: NewsItem) => [n.id, n]),
      ).values(),
    ].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  });
}
export async function options(
  symbol: string,
  expiry?: string,
): Promise<OptionChain> {
  const provider = marketStatus().provider;
  if (provider === "demo") {
    const S = demoQuote(symbol).price!,
      expiries = [7, 14, 30, 60, 90].map((days) => {
        const date = new Date(Date.now() + days * 86400000);
        date.setUTCDate(date.getUTCDate() + ((5 - date.getUTCDay() + 7) % 7));
        return date.toISOString().slice(0, 10);
      });
    const e = expiry || expiries[0],
      T = daysToExpiry(e) / 365,
      spacing = S > 200 ? 5 : 2.5,
      base = Math.round(S / spacing) * spacing;
    const contracts = Array.from(
      { length: 17 },
      (_, i) => base + (i - 8) * spacing,
    ).flatMap((strike, i) =>
      (["call", "put"] as const).map((type) => {
        const iv =
            0.26 +
            Math.abs(Math.log(strike / S)) * 0.5 +
            (hash(symbol) % 12) / 100,
          mid = bsmPrice(S, strike, T, 0.04, iv, 0.005, type),
          greeks = bsmGreeks(S, strike, T, 0.04, iv, 0.005, type);
        return {
          ticker: `${symbol}-${e}-${type}-${strike}`,
          type,
          strike,
          expiry: e,
          bid: Math.max(0, mid - 0.08),
          ask: mid + 0.08,
          iv,
          volume: Math.round(
            150 + 4000 * Math.exp(-Math.abs(strike - S) / 15) + i * 39,
          ),
          openInterest: Math.round(
            500 + 13000 * Math.exp(-Math.abs(strike - S) / 25),
          ),
          delta: greeks.delta,
          multiplier: 100,
          asOf: new Date().toISOString(),
        };
      }),
    );
    return { contracts, expiries, truncated: false, source: "Simulated" };
  }
  if (provider === "yahoo")
    return cached(`cboe:${symbol}:${expiry || ""}`, 60000, async () => {
      const d = await getJson(
        `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`,
      );
      const rows: OptionContract[] = (d.data?.options || []).flatMap(
        (o: any) => {
          const match =
            /^([A-Z0-9.]{1,7}?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(
              o.option || "",
            );
          if (!match) return [];
          return [
            {
              ticker: o.option,
              type: match[5] === "C" ? "call" : "put",
              strike: Number(match[6]) / 1000,
              expiry: `20${match[2]}-${match[3]}-${match[4]}`,
              bid: nullable(o.bid),
              ask: nullable(o.ask),
              iv: nullable(o.iv) !== null && o.iv > 0 ? o.iv : null,
              volume: nullable(o.volume),
              openInterest: nullable(o.open_interest),
              delta: nullable(o.delta),
              multiplier: 100,
              // Cboe gives no per-contract bid/ask quote time.
              asOf: null,
            } as OptionContract,
          ];
        },
      );
      const expiries = [
        ...new Set(
          rows.map((o) => o.expiry).filter((e) => daysToExpiry(e) > 0),
        ),
      ].sort();
      return {
        contracts: rows.filter((o) => o.expiry === (expiry || expiries[0])),
        expiries,
        truncated: false,
        source: "Cboe · 15-minute delayed",
        snapshotGeneratedAt: cboeGeneratedAt(d.timestamp),
      };
    });
  const chain = await cached(
    `options:${symbol}:${expiry || ""}`,
    30000,
    async (): Promise<OptionChain> => {
      const params: Record<string, string> = {
        limit: "250",
        sort: "expiration_date",
        order: "asc",
        "expiration_date.gte": new Date().toISOString().slice(0, 10),
      };
      if (expiry) params.expiration_date = expiry;
      let page = await massive(
          `/v3/snapshot/options/${encodeURIComponent(symbol)}`,
          params,
        ),
        all: any[] = [...(page.results || [])],
        n = 1;
      // Bound provider requests; explicitly disclose partial chain instead of hiding truncation.
      while (page.next_url && n < 4) {
        page = await massive(page.next_url);
        all.push(...(page.results || []));
        n++;
      }
      const rows: OptionContract[] = all.map((o) => ({
        ticker: o.details.ticker,
        type: o.details.contract_type,
        strike: o.details.strike_price,
        expiry: o.details.expiration_date,
        bid: nullable(o.last_quote?.bid),
        ask: nullable(o.last_quote?.ask),
        // Massive sends 0 when it could not compute IV; that is not a real volatility.
        iv: positive(o.implied_volatility),
        volume: nullable(o.day?.volume),
        openInterest: nullable(o.open_interest),
        delta: nullable(o.greeks?.delta),
        multiplier: o.details.shares_per_contract || 100,
        asOf: timestamp(o.last_quote?.last_updated),
      }));
      const found = [...new Set(rows.map((o) => o.expiry))].sort();
      return {
        contracts: expiry ? rows : rows.filter((o) => o.expiry === found[0]),
        expiries: found,
        truncated: Boolean(page.next_url),
        source: "Massive",
      };
    },
  );
  return { ...chain, expiries: rememberExpiries(symbol, chain.expiries) };
}
