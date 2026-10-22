"use client";

import { useEffect } from "react";
import type { RiskLevel } from "@/lib/domain/types";

export function Button({
  children,
  variant = "primary",
  busy,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger"; busy?: boolean }) {
  const styles = {
    primary: "bg-accent text-bg hover:brightness-110 disabled:bg-line disabled:text-faint",
    ghost: "border border-line-strong text-text hover:border-accent disabled:text-faint",
    danger: "border border-danger/60 text-danger hover:bg-danger/10 disabled:opacity-50",
  }[variant];
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded px-4 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "num h-11 w-full rounded border border-line bg-panel-2 px-3 text-text outline-none focus:border-accent";

const LEVEL_STYLE: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-line-strong text-muted" },
  funding: { label: "Funding", cls: "border-accent/50 text-accent" },
  opening: { label: "Opening", cls: "border-accent/50 text-accent" },
  active: { label: "Active", cls: "border-ok/50 text-ok" },
  closing: { label: "Closing", cls: "border-line-strong text-muted" },
  closed: { label: "Closed", cls: "border-line text-faint" },
  failed: { label: "Failed", cls: "border-danger/60 text-danger" },
  watch: { label: "Watch", cls: "border-watch/60 text-watch" },
  action: { label: "Action needed", cls: "border-danger/60 text-danger" },
  margin_call: { label: "Margin call", cls: "border-danger bg-danger/15 text-danger" },
  reduce_only: { label: "Reduce only", cls: "border-danger bg-danger/15 text-danger" },
  liquidation: { label: "Liquidation", cls: "border-danger bg-danger/25 text-danger" },
};

export function StateChip({ status, level }: { status: string; level?: RiskLevel }) {
  const key = status === "active" && level && level !== "ok" ? level : status;
  const s = LEVEL_STYLE[key] ?? LEVEL_STYLE.draft;
  return <span className={`num inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] uppercase tracking-wider ${s.cls}`}>{s.label}</span>;
}

/** Margin health from 0% to 100%, with ticks at Locke's levels and Strike's 70% and 90%. */
export function MarginBar({ ratio, watch, action }: { ratio: number | null; watch: number; action: number }) {
  const r = ratio == null ? 0 : Math.min(1, Math.max(0, ratio));
  const color = r >= 0.7 || (ratio ?? 0) >= action ? "bg-danger" : (ratio ?? 0) >= watch ? "bg-watch" : "bg-accent";
  const ticks = [
    { at: Math.min(watch, 1), label: "Locke watch" },
    { at: Math.min(action, 1), label: "Locke action" },
    { at: 0.7, label: "Strike margin call" },
    { at: 0.9, label: "Strike reduce-only" },
  ];
  return (
    <div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-sm bg-panel-2" role="meter" aria-valuenow={Math.round(r * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Margin health">
        <div className={`h-full ${color} transition-all duration-700`} style={{ width: `${Math.max(1.5, r * 100)}%` }} />
        {ticks.map((t) => (
          <span key={t.label} title={t.label} className="absolute top-0 h-full w-px bg-text/40" style={{ left: `${t.at * 100}%` }} />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-faint">
        <span>Healthy</span>
        <span>Margin call 70% · Liquidation 100%</span>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num mt-0.5 text-base ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-danger" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bracket accent max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5 sm:rounded"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>;
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
}
