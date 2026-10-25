"use client";

import { useEffect, useRef, useState } from "react";

/** A number that flashes green when it rises and red when it falls, then settles back. */
export function LiveValue({ value, format, className = "" }: { value: number; format: (n: number) => string; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const text = format(value);
  const prevText = useRef(text);

  useEffect(() => {
    // Only a change the reader can see counts: sub-display jitter doesn't flash.
    if (text !== prevText.current && isFinite(value) && isFinite(prev.current)) {
      setDir(value > prev.current ? "up" : "down");
      const t = setTimeout(() => setDir(null), 700);
      prev.current = value;
      prevText.current = text;
      return () => clearTimeout(t);
    }
    prev.current = value;
    prevText.current = text;
  }, [value, text]);

  return (
    <span
      className={`rounded-md transition-colors duration-500 ${dir === "up" ? "bg-ok/15" : dir === "down" ? "bg-danger/15" : "bg-transparent"} ${className}`}
    >
      {text}
    </span>
  );
}
