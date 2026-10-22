// Server-safe primitives: no hooks, no handlers of their own. Client-only controls live in form.tsx.

import Link from "next/link";
import type { RiskLevel } from "@/lib/domain/types";

// ── Layout ──

export type Tone = "paper" | "mist" | "ink" | "cobalt" | "lime" | "danger" | "watch";

const TONE: Record<Tone, string> = {
  paper: "bg-paper text-ink",
  mist: "bg-mist text-ink",
  ink: "bg-ink text-paper",
  cobalt: "bg-cobalt text-paper",
  lime: "bg-lime text-ink",
  danger: "bg-danger text-paper",
  watch: "bg-watch text-ink",
};

/** Muted text colour that stays legible on each card tone. */
export const SUBTLE: Record<Tone, string> = {
  paper: "text-ink-2",
  mist: "text-ink-2",
  ink: "text-paper/55",
  cobalt: "text-paper/70",
  lime: "text-ink/60",
  danger: "text-paper/75",
  watch: "text-ink/65",
};

export function Card({
  tone = "paper",
  className = "",
  children,
  as: As = "div",
  ...rest
}: { tone?: Tone; as?: "div" | "section" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As {...rest} className={`rounded-[var(--radius-card)] p-4 sm:p-6 ${TONE[tone]} ${className}`}>
      {children}
    </As>
  );
}

/** Two-tone display heading: a statement in ink, its continuation in grey. */
export function Display({
  lead,
  rest,
  size = "lg",
  as: As = "h1",
  className = "",
  restClass = "text-ink-3",
}: {
  lead: React.ReactNode;
  rest?: React.ReactNode;
  size?: "xl" | "lg" | "md" | "sm";
  as?: "h1" | "h2" | "h3";
  className?: string;
  restClass?: string;
}) {
  const sizes = {
    xl: "text-[32px] sm:text-[52px] lg:text-[64px]",
    lg: "text-[28px] sm:text-[38px]",
    md: "text-[24px] sm:text-[30px]",
    sm: "text-[20px] sm:text-[22px]",
  };
  return (
    <As className={`display ${sizes[size]} ${className}`}>
      {lead}
      {rest && (
        <>
          {" "}
          <span className={restClass}>{rest}</span>
        </>
      )}
    </As>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

// ── Controls ──

type ButtonVariant = "primary" | "ink" | "ghost" | "danger" | "paper";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-cobalt text-paper hover:bg-cobalt-deep disabled:bg-mist disabled:text-ink-3",
  ink: "bg-ink text-paper hover:bg-ink/85 disabled:bg-mist disabled:text-ink-3",
  paper: "bg-paper text-ink hover:bg-paper/85 disabled:text-ink-3",
  ghost: "bg-paper text-ink ring-1 ring-line ring-inset hover:ring-ink disabled:text-ink-3",
  danger: "bg-paper text-danger ring-1 ring-danger/40 ring-inset hover:bg-danger hover:text-paper disabled:opacity-50",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  busy,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "lg"; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background,color,box-shadow,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${
        size === "lg" ? "h-14 px-7 text-[16px]" : "h-11 px-5 text-[14px]"
      } ${BUTTON[variant]} ${className}`}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

/** A navigation that looks like a Button. Actions that are their own page use this. */
export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background,color,box-shadow] duration-200 ${
        size === "lg" ? "h-14 px-7 text-[16px]" : "h-11 px-5 text-[14px]"
      } ${BUTTON[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export const inputCls =
  "num h-12 w-full rounded-xl bg-mist px-4 text-[16px] text-ink outline-none ring-1 ring-transparent transition placeholder:text-ink-3 focus:bg-paper focus:ring-cobalt";

// ── Status ──

const CHIP: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-mist text-ink-2" },
  funding: { label: "Funding", cls: "bg-paper text-cobalt" },
  opening: { label: "Opening", cls: "bg-paper text-cobalt" },
  active: { label: "Protected", cls: "bg-paper text-ok" },
  closing: { label: "Closing", cls: "bg-mist text-ink-2" },
  closed: { label: "Closed", cls: "bg-mist text-ink-3" },
  failed: { label: "Failed", cls: "bg-danger text-paper" },
  watch: { label: "Watch", cls: "bg-watch text-ink" },
  action: { label: "Action needed", cls: "bg-danger text-paper" },
  margin_call: { label: "Margin call", cls: "bg-danger text-paper" },
  reduce_only: { label: "Reduce only", cls: "bg-danger text-paper" },
  liquidation: { label: "Liquidation", cls: "bg-ink text-danger" },
};

export function StateChip({ status, level }: { status: string; level?: RiskLevel }) {
  const key = status === "active" && level && level !== "ok" ? level : status;
  const s = CHIP[key] ?? CHIP.draft;
  return (
    <span className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ${s.cls}`}>
      {(key === "active" || key === "opening" || key === "funding") && (
        <span className={`h-1.5 w-1.5 rounded-full bg-current ${key !== "active" ? "animate-pulse" : ""}`} aria-hidden />
      )}
      {s.label}
    </span>
  );
}

/** Margin health 0–100%, ticks at Locke's levels and Strike's 70% / 90%. */
export function MarginBar({
  ratio,
  watch,
  action,
  onDark = false,
}: {
  ratio: number | null;
  watch: number;
  action: number;
  onDark?: boolean;
}) {
  const r = ratio == null ? 0 : Math.min(1, Math.max(0, ratio));
  const fill = (ratio ?? 0) >= action || r >= 0.7 ? "bg-danger" : (ratio ?? 0) >= watch ? "bg-watch" : onDark ? "bg-paper" : "bg-ink";
  const ticks = [
    { at: Math.min(watch, 1), label: "Locke watch" },
    { at: Math.min(action, 1), label: "Locke action" },
    { at: 0.7, label: "Strike margin call" },
    { at: 0.9, label: "Strike reduce-only" },
  ];
  return (
    <div>
      <div
        className={`relative h-3 w-full overflow-hidden rounded-full ${onDark ? "bg-paper/15" : "bg-mist"}`}
        role="meter"
        aria-label="Margin health"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(r * 100)}
      >
        <div className={`h-full rounded-full ${fill} transition-[width] duration-700`} style={{ width: `${Math.max(2, r * 100)}%` }} />
        {ticks.map((t) => (
          <span key={t.label} title={t.label} className={`absolute top-0 h-full w-0.5 ${onDark ? "bg-paper/30" : "bg-paper"}`} style={{ left: `${t.at * 100}%` }} />
        ))}
      </div>
      <div className={`num mt-2 flex justify-between text-[11px] ${onDark ? "text-paper/50" : "text-ink-3"}`}>
        <span>Healthy</span>
        <span>Margin call 70% · Liquidation 100%</span>
      </div>
    </div>
  );
}

/** Clips long text to one line, then shows all of it while hovered. */
export const REVEAL = "truncate hover:overflow-visible hover:whitespace-normal hover:[overflow-wrap:anywhere]";

export function Stat({
  label,
  value,
  sub,
  tone,
  subtle = "text-ink-2",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ok" | "bad";
  subtle?: string;
}) {
  return (
    <div className="min-w-0">
      <div className={`text-[13px] ${subtle}`}>{label}</div>
      <div className={`num mt-1 ${REVEAL} text-[17px] ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-[12px] ${subtle}`}>{sub}</div>}
    </div>
  );
}

// ── Feedback ──

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[14px] text-danger">
      {error}
    </p>
  );
}

export function Notice({ tone = "watch", children }: { tone?: "watch" | "danger" | "info"; children: React.ReactNode }) {
  const cls = { watch: "bg-watch/20 text-ink", danger: "bg-danger/10 text-danger", info: "bg-paper text-ink-2" }[tone];
  return <div className={`rounded-2xl px-4 py-3 text-[14px] ${cls}`}>{children}</div>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-cobalt border-t-transparent ${className}`} aria-label="Loading" />;
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M2 8h11M9 3.5L13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
