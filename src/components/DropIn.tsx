"use client";

import { useEffect, useRef } from "react";

/**
 * A container whose direct children fall in one after another (from just above, with one bounce)
 * the first time it scrolls into view. Children stay hidden only while `data-drop` is set and
 * `data-in` isn't; the root layout's <noscript> rule shows them without JavaScript, and reduced
 * motion skips the effect.
 */
export function DropIn({
  className = "",
  step = 90,
  children,
  ...rest
}: { className?: string; step?: number; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty("--drop-delay", `${Math.min(i, 10) * step}ms`));
    // Start once a good part of the grid is on screen, so the fall is actually seen.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.setAttribute("data-in", "");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [step]);

  return (
    <div ref={ref} data-drop="" className={className} {...rest}>
      {children}
    </div>
  );
}

/**
 * Hero wrapper: descendants marked `.fall` fall in once, after the page has mounted (so the
 * animation runs on the final DOM only). Only tiles on screen fall: column by column, each column
 * stacking from the bottom up so a falling tile never crosses one that has landed. Off-screen
 * candidates are marked `data-still` and simply appear.
 */
export function FallIn({ className = "", children, ...rest }: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cols = new Map<number, { el: HTMLElement; top: number }[]>();
    for (const el of root.querySelectorAll<HTMLElement>(".fall")) {
      const r = el.getBoundingClientRect();
      if (r.top >= window.innerHeight || r.bottom <= 0) {
        el.setAttribute("data-still", "");
        continue;
      }
      const key = Math.round(r.left);
      cols.set(key, [...(cols.get(key) ?? []), { el, top: r.top }]);
    }
    [...cols.keys()]
      .sort((a, b) => a - b)
      .forEach((key, c) =>
        cols
          .get(key)!
          .sort((a, b) => b.top - a.top)
          .forEach(({ el }, row) => el.style.setProperty("--fall-delay", `${c * 50 + row * 70}ms`)),
      );
    // Two frames: let the hidden state paint before the fall starts.
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => ref.current?.setAttribute("data-in", ""));
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, []);
  return (
    <div ref={ref} data-fall="" className={className} {...rest}>
      {children}
    </div>
  );
}
