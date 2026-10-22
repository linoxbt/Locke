"use client";

import { useEffect, useId } from "react";
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
    <As {...rest} className={`rounded-[var(--radius-card)] p-5 sm:p-7 ${TONE[tone]} ${className}`}>
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
    xl: "text-[44px] sm:text-[76px] lg:text-[96px]",
    lg: "text-[38px] sm:text-[56px]",
    md: "text-[30px] sm:text-[40px]",
    sm: "text-[24px] sm:text-[28px]",
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
        size === "lg" ? "h-16 px-8 text-lg" : "h-12 px-6 text-[15px]"
      } ${BUTTON[variant]} ${className}`}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * Label + control. Use `group` when the control is a set of buttons: a <label> would forward
 * clicks on its text to the first button and silently change the selection.
 */
export function Field({
  label,
  hint,
  group = false,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  group?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  const inner = (
    <>
      <span id={id} className="mb-2 block text-sm text-ink-2">
        {label}
      </span>
      {children}
      {hint && <span className="mt-2 block text-[13px] leading-snug text-ink-3">{hint}</span>}
    </>
  );
  return group ? (
    <div role="group" aria-labelledby={id} className="block">
      {inner}
    </div>
  ) : (
    <label className="block">{inner}</label>
  );
}

export const inputCls =
  "num h-14 w-full rounded-2xl bg-mist px-4 text-lg text-ink outline-none ring-1 ring-transparent transition placeholder:text-ink-3 focus:bg-paper focus:ring-cobalt";

/** Segmented pill control. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-mist p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-12 flex-1 rounded-full text-[15px] transition ${value === o.value ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  className = "text-cobalt",
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(n: number): void;
  label: string;
  className?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`w-full ${className}`}
      style={{ ["--fill" as string]: `${fill}%` }}
    />
  );
}

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
      <div className={`num mt-1 truncate text-xl ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-[12px] ${subtle}`}>{sub}</div>}
    </div>
  );
}

// ── Overlays and feedback ──

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: React.ReactNode }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="max-h-[92dvh] w-full max-w-lg animate-rise overflow-y-auto rounded-t-[28px] bg-paper p-6 sm:rounded-[28px] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <h2 id={id} className="display text-[28px]">
            {title}
          </h2>
          <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist text-ink-2 hover:text-ink" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

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
