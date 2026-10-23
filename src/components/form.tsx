"use client";

// Interactive form controls (hooks / handlers). Server-safe primitives live in ui.tsx.

import { useId } from "react";

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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-[22px] bg-mist p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-10 flex-1 whitespace-nowrap rounded-full px-3 text-[13px] transition ${value === o.value ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
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

