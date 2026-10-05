import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { X, Info, TriangleAlert, CircleAlert } from "lucide-react";
import { percent, tone } from "./format";
export type ResolvedTheme = "light" | "dark";
export const ThemeContext = createContext<ResolvedTheme>("light");
/** Chart libraries need literal colours; read them from the active theme's CSS tokens. */
export function useChartColors() {
  const theme = useContext(ThemeContext);
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement),
      v = (name: string) => css.getPropertyValue(name).trim();
    return {
      accent: v("--accent"),
      grid: v("--border"),
      axis: v("--text-3"),
      text: v("--text"),
      surface: v("--surface"),
      border: v("--border-strong"),
      up: v("--up"),
      down: v("--down"),
      series: [1, 2, 3, 4, 5, 6].map((i) => v(`--series-${i}`)),
      theme,
    };
  }, [theme]);
}
export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content runs edge to edge (tables). */
  flush?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? "card-body flush" : "card-body"}>{children}</div>
    </section>
  );
}
export function Delta({
  value,
  children,
}: {
  value: number | null | undefined;
  children?: ReactNode;
}) {
  return (
    <span className={`delta ${tone(value)}`}>{children ?? percent(value)}</span>
  );
}
export function Stat({
  label,
  value,
  sub,
  valueTone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueTone?: number | null;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong
        className={`stat-value ${valueTone === undefined ? "" : tone(valueTone)}`}
      >
        {value}
      </strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Notice({
  kind = "info",
  children,
  action,
  onDismiss,
}: {
  kind?: "info" | "warn" | "error";
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const Icon =
    kind === "info" ? Info : kind === "warn" ? TriangleAlert : CircleAlert;
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon size={16} aria-hidden />
      <div className="notice-text">{children}</div>
      {action}
      {onDismiss && (
        <button
          className="icon-button"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function Ticker({ symbol, name }: { symbol: string; name?: string }) {
  return (
    <span className="ticker">
      <b>{symbol}</b>
      {name && name !== symbol && <small>{name}</small>}
    </span>
  );
}
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented ${size}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Badge({
  children,
  kind = "neutral",
}: {
  children: ReactNode;
  kind?: "neutral" | "accent" | "warn" | "up" | "down";
}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    // Captured on the first render, before any field inside takes focus.
    opener = useRef(document.activeElement as HTMLElement | null);
  close.current = onClose;
  useEffect(() => {
    const previous = opener.current;
    const first = ref.current?.querySelector<HTMLElement>(
      "[autofocus], input, select, button:not(.icon-button)",
    );
    (first || ref.current)?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key !== "Tab") return;
      const items = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[tabindex='0']",
        ) || []),
      ];
      if (!items.length) return;
      const firstItem = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", listener);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.classList.remove("modal-open");
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
