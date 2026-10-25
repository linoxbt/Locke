"use client";

import { useEffect, useState } from "react";
import type { MarkTick } from "@/lib/domain/live";

/** No tick for this long means the socket is half-open: reconnect. Strike sends one a second. */
const SILENT_MS = 8_000;

/**
 * Strike's public mark-price stream for one symbol, one tick a second. Null until the first tick
 * and whenever the stream is down for long; callers fall back to the server's last read.
 */
export function useLiveMark(url: string | null, symbol: string, enabled: boolean): MarkTick | null {
  const [tick, setTick] = useState<MarkTick | null>(null);

  useEffect(() => {
    if (!enabled || !url || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let last = Date.now();

    const connect = () => {
      if (closed) return;
      last = Date.now();
      ws = new WebSocket(url);
      ws.onopen = () => {
        attempts = 0;
        ws?.send(JSON.stringify({ id: 1, method: "subscribe", channel: "markPrice@1s", symbol }));
      };
      ws.onmessage = (m) => {
        for (const line of String(m.data).split("\n")) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            for (const ev of Array.isArray(msg) ? msg : [msg]) {
              if (ev?.e !== "markPriceUpdate" || ev.s !== symbol) continue;
              const mark = parseFloat(ev.p);
              if (!(mark > 0)) continue;
              last = Date.now();
              setTick({ mark, fundingRate: parseFloat(ev.r) || 0, nextFundingTime: Number(ev.T) || null, at: last });
            }
          } catch {
            /* ignore a malformed frame */
          }
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry = setTimeout(connect, Math.min(15_000, 1_000 * 2 ** attempts++));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    const watchdog = setInterval(() => {
      if (Date.now() - last > SILENT_MS && ws?.readyState === WebSocket.OPEN) ws.close();
      // A stream that stays down for long stops passing as live.
      if (Date.now() - last > 3 * SILENT_MS) setTick(null);
    }, 2_000);

    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      ws?.close();
    };
  }, [url, symbol, enabled]);

  return tick;
}
