const finite = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n);
export const money = (n: number | null | undefined, digits = 2) =>
  !finite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(n);
/** Signed currency, e.g. "+$12.40" / "−$3.10". */
export const signedMoney = (n: number | null | undefined, digits = 2) =>
  !finite(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n), digits);
export const number = (n: number | null | undefined, digits = 2) =>
  !finite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
export const percent = (n: number | null | undefined, digits = 2) =>
  !finite(n)
    ? "—"
    : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
/** Greeks span many magnitudes: keep significant digits instead of fixed decimals. */
export const significant = (n: number | null | undefined, digits = 4) => {
  if (!finite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  return abs >= 1e-3 && abs < 1e6
    ? Number(n.toPrecision(digits)).toString()
    : n.toExponential(digits - 1);
};
/** Gain / loss tone; exactly zero is neutral. */
export const tone = (n: number | null | undefined) =>
  !finite(n) || n === 0 ? "flat" : n > 0 ? "up" : "down";
export const clock = (iso: string | null | undefined, withZone = false) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        ...(withZone ? { timeZoneName: "short" } : {}),
      });
/** Quote times in New York, where US equities trade. */
export const marketClock = (iso: string | null | undefined) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        ...(new Date(iso).toDateString() === new Date().toDateString()
          ? {}
          : { month: "short", day: "numeric" }),
        hour: "numeric",
        minute: "2-digit",
      }) + " ET";
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
/** Regular US session, Mon–Fri 9:30–16:00 New York. Exchange holidays are not detected. */
export function regularSession(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (
    !["Sat", "Sun"].includes(parts.weekday) && minutes >= 570 && minutes < 960
  );
}
export const expiryLabel = (expiry: string, days: number) =>
  `${new Date(expiry + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} · ${Number.isFinite(days) ? (days < 1 ? "expires today" : `${Math.ceil(days)}d`) : "—"}`;
