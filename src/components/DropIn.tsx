"use client";

import { useEffect, useRef } from "react";

/**
 * A container whose direct children drop in one after another the first time it scrolls into
 * view. Children stay hidden only while `data-drop` is set and `data-in` isn't, and the root
 * layout's <noscript> rule shows them without JavaScript; reduced motion skips the effect.
 */
export function DropIn({
  className = "",
  step = 55,
  children,
  ...rest
}: { className?: string; step?: number; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty("--drop-delay", `${Math.min(i, 10) * step}ms`));
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.setAttribute("data-in", "");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
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
