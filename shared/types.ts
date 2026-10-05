export type Position = { symbol: string; shares: number; costBasis: number };
export type Portfolio = {
  initialCapital: number;
  netContributions: number;
  cash: number;
  positions: Position[];
  watchlist: string[];
  isSample: boolean;
  revision: number;
};
export type Quote = {
  symbol: string;
  name: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
  source: string;
  /** When the server last fetched this quote from the provider (ISO UTC). */
  fetchedAt?: string;
};
export type Bar = { time: string; close: number };
export type NewsItem = {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  publishedAt: string;
  symbols: string[];
  description: string;
};
export type OptionContract = {
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  bid: number | null;
  ask: number | null;
  iv: number | null;
  volume: number | null;
  openInterest: number | null;
  delta: number | null;
  multiplier: number;
  asOf: string | null;
};
export type MarketStatus = {
  provider: string;
  recency: string;
  pollMs: number;
  configured: boolean;
  model: string;
};
export type OptionChain = {
  contracts: OptionContract[];
  expiries: string[];
  truncated: boolean;
  source: string;
  /** When the provider generated the whole chain snapshot (ISO UTC). Not a quote time. */
  snapshotGeneratedAt?: string | null;
  /** The provider's underlying price for this snapshot, when it sends one. */
  underlying?: number | null;
};
/** Average valid call/put IV at the strike nearest spot; unavailable without a spot price. */
export function nearMoneyIV(
  contracts: OptionContract[],
  spot: number | null | undefined,
): number | null {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;
  const valid = contracts.filter(
    (c) => c.iv !== null && Number.isFinite(c.iv) && c.iv > 0,
  );
  if (!valid.length) return null;
  const distance = Math.min(...valid.map((c) => Math.abs(c.strike - spot))),
    nearest = valid.filter((c) => Math.abs(c.strike - spot) === distance),
    strike = Math.min(...nearest.map((c) => c.strike)),
    atStrike = nearest.filter((c) => c.strike === strike);
  return atStrike.reduce((s, c) => s + c.iv!, 0) / atStrike.length;
}
