import type { Portfolio, Quote } from "./types.js";
export function valuePortfolio(portfolio: Portfolio, quotes: Quote[]) {
  const map = new Map(quotes.map((q) => [q.symbol, q]));
  const positions = portfolio.positions.map((p) => {
    const quote = map.get(p.symbol);
    // A non-positive or non-finite price is a missing quote, never a real valuation.
    const price =
      quote?.price != null && Number.isFinite(quote.price) && quote.price > 0
        ? quote.price
        : null;
    const value = price === null ? null : price * p.shares;
    return {
      ...p,
      price,
      value,
      gain: value === null ? null : value - p.costBasis,
      quote,
    };
  });
  const complete = positions.every((p) => p.value !== null);
  const invested = portfolio.positions.reduce((sum, p) => sum + p.costBasis, 0);
  const equityValue = complete
    ? positions.reduce((sum, p) => sum + p.value!, 0)
    : null;
  const totalValue = equityValue === null ? null : equityValue + portfolio.cash;
  const unrealized = equityValue === null ? null : equityValue - invested;
  const capital = portfolio.initialCapital + portfolio.netContributions;
  const sinceStart = totalValue === null ? null : totalValue - capital;
  const dayChange = positions.every((p) => p.quote?.change != null)
    ? positions.reduce((sum, p) => sum + p.shares * p.quote!.change!, 0)
    : null;
  return {
    positions,
    complete,
    invested,
    equityValue,
    totalValue,
    unrealized,
    sinceStart,
    capital,
    returnPercent:
      capital > 0 && sinceStart !== null ? (sinceStart / capital) * 100 : null,
    dayChange,
  };
}
