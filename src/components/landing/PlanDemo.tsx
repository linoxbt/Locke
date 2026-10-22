"use client";

import { useState } from "react";
import { costsOutcome, holdingsOutcome } from "@/lib/domain/plans";
import type { CostsInputs, HoldingsInputs } from "@/lib/domain/types";
import { local, usd } from "@/lib/ui/format";

const HOLD: HoldingsInputs = { asset: "ADA", amountHeld: 50_000, sharePct: 100, leverage: 1, bufferPct: 25 };
const COST: CostsInputs = {
  fuelType: "diesel",
  litresPerMonth: 2000,
  pumpPrice: 1250,
  fxRate: 1530,
  currency: "NGN",
  months: 3,
  crudeSharePct: 100,
  leverage: 1,
  bufferPct: 25,
};

/** Drag a price move and watch a plan hold. Uses Locke's own outcome functions. */
export function PlanDemo({ ada, wti }: { ada: number; wti: number }) {
  const [type, setType] = useState<"holdings" | "costs">("holdings");
  const [move, setMove] = useState(-30);
  const m = move / 100;

  let without: number;
  let withL: number;
  let fmt: (n: number) => string;
  if (type === "holdings") {
    const o = holdingsOutcome(HOLD, HOLD.amountHeld, ada, ada * (1 + m));
    without = o.without;
    withL = o.with;
    fmt = (n) => usd(n, 0);
  } else {
    const size = (COST.litresPerMonth * COST.months * COST.pumpPrice) / COST.fxRate / wti;
    const o = costsOutcome(COST, size, wti, wti * (1 + m));
    without = o.without;
    withL = o.with;
    fmt = (n) => local(n, "NGN", 0);
  }
  const max = Math.max(without, withL) * 1.05;

  return (
    <div className="mx-auto w-full max-w-[760px] rounded-[20px] bg-paper p-4 text-ink sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full bg-mist p-1" role="radiogroup" aria-label="Plan type">
          {(
            [
              ["holdings", "50,000 ADA treasury"],
              ["costs", "2,000 L diesel a month"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="radio"
              aria-checked={type === k}
              onClick={() => setType(k)}
              className={`h-10 rounded-full px-4 text-[14px] transition ${type === k ? "bg-ink text-paper" : "text-ink-2"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="num text-[13px] text-ink-3">{type === "holdings" ? "ADA" : "Crude"} moves {move > 0 ? "+" : ""}{move}%</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { label: type === "holdings" ? "Treasury without Locke" : "Monthly bill without Locke", v: without, bar: "bg-mist", text: "text-ink-2" },
          { label: type === "holdings" ? "Treasury with Locke" : "Monthly bill with Locke", v: withL, bar: type === "holdings" ? "bg-cobalt" : "bg-lime", text: "text-ink" },
        ].map((r) => (
          <div key={r.label} className="rounded-2xl bg-canvas p-4 sm:p-5">
            <div className="text-[14px] text-ink-2">{r.label}</div>
            <div className={`num mt-2 text-[26px] leading-none sm:text-[32px] ${r.text}`}>{fmt(r.v)}</div>
            <div className="mt-4 h-2 rounded-full bg-paper">
              <div className={`h-full rounded-full ${r.bar} transition-[width] duration-300`} style={{ width: `${Math.max(2, (r.v / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <label className="mt-8 block">
        <span className="sr-only">Price move</span>
        <input
          type="range"
          min={-50}
          max={50}
          step={5}
          value={move}
          onChange={(e) => setMove(Number(e.target.value))}
          className="w-full text-ink"
          style={{ ["--fill" as string]: `${((move + 50) / 100) * 100}%` }}
        />
      </label>
      <div className="num mt-1 flex justify-between text-[12px] text-ink-3">
        <span>−50%</span>
        <span>0</span>
        <span>+50%</span>
      </div>
      <p className="mt-4 text-[13px] text-ink-3">
        Illustration at today&apos;s Strike prices, fully hedged, before funding and fees. Your own plan shows these numbers for your amounts.
      </p>
    </div>
  );
}
