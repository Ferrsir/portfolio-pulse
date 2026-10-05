export type Kind = "call" | "put";
export function bsmPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  q?: number,
  kind?: Kind,
): number;
export function bsmGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  q?: number,
  kind?: Kind,
): {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna: number;
  volga: number;
};
export function impliedVol(
  price: number,
  S: number,
  K: number,
  T: number,
  r: number,
  q?: number,
  kind?: Kind,
): number;
export function americanPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  q: number,
  kind: Kind,
  steps: number,
): number;
export function europeanTree(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  q: number,
  kind: Kind,
  steps: number,
): number;
