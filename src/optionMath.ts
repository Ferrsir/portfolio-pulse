import type { OptionContract } from "../shared/types";
/** Above this, a provider IV is usually a deep in/out-of-the-money or expiring artefact. */
export const IMPLAUSIBLE_IV = 3;
/** Bid/ask midpoint when both sides form a valid market, else null. */
export const midpoint = (c: Pick<OptionContract, "bid" | "ask">) =>
  c.bid !== null && c.ask !== null && c.bid >= 0 && c.ask > 0 && c.ask >= c.bid
    ? (c.bid + c.ask) / 2
    : null;
