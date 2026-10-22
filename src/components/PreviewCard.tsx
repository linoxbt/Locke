"use client";

import type { CostsInputs, HoldingsInputs, PlanType, Preview } from "@/lib/domain/types";
import { localCompact, num, pct, price, signedUsd, usd } from "@/lib/ui/format";
import { Stat } from "./ui";

export function hedgeInWords(type: PlanType, p: Preview): string {
  const s = p.sizing;
  if (type === "holdings") {
    return `Locke sells ${num(s.size, 0)} ADA on Strike. If ADA falls, the hedge gains what your treasury loses.`;
  }
  return `Locke buys ${num(s.size, 2)} WTI on Strike. If crude rises, the hedge gains and pays down your fuel bill.`;
}

export function PreviewCard({
  type,
  inputs,
  preview,
  adaPrice,
}: {
  type: PlanType;
  inputs: HoldingsInputs | CostsInputs;
  preview: Preview;
  adaPrice: number | null;
}) {
  const s = preview.sizing;
  const cur = type === "costs" ? (inputs as CostsInputs).currency : "USD";
  const fmtOutcome = (n: number) => (type === "holdings" ? usd(n, 0) : localCompact(n, cur));
  const noFunding = Math.abs(preview.fundingPerDayUsd) < 0.005;
  const marginAda = adaPrice ? s.requiredUsd / adaPrice : null;
  const fundingLabel = preview.fundingPerDayUsd >= 0 ? "received" : "paid";

  return (
    <div className="bracket accent p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="num text-[11px] uppercase tracking-wider text-accent">{preview.label}</span>
        <span className="num text-xs text-muted">
          {s.symbol} · {s.side === "sell" ? "short" : "long"} · {s.leverage}x
        </span>
      </div>
      <p className="mt-3 text-base">{hedgeInWords(type, preview)}</p>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Hedge size" value={`${num(s.size, type === "holdings" ? 0 : 2)} ${type === "holdings" ? "ADA" : "WTI"}`} sub={usd(s.notional)} />
        <Stat
          label="Margin to deposit"
          value={usd(s.requiredUsd)}
          sub={marginAda ? `≈ ${num(marginAda, 0)} ADA` : undefined}
        />
        <Stat label="Opening cost" value={usd(s.openFeeUsd)} sub="taker + builder fee" />
        <Stat
          label="Cost of protection"
          value={noFunding ? "$0.00" : signedUsd(preview.fundingPerDayUsd)}
          sub={noFunding ? "funding is flat today" : `per day, ${fundingLabel} at today's rate`}
          tone={!noFunding && preview.fundingPerDayUsd > 0 ? "ok" : undefined}
        />
      </div>

      <div className="mt-6">
        <h3 className="text-xs uppercase tracking-wider text-muted">
          {type === "holdings" ? "Treasury value (USD)" : `Monthly fuel bill (${cur}) — crude-share model`}
        </h3>
        <div className="mt-2">
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="py-1.5 font-normal">{type === "holdings" ? "ADA moves" : "Crude moves"}</th>
                <th className="hidden py-1.5 font-normal sm:table-cell">Price</th>
                <th className="py-1.5 text-right font-normal">Without Locke</th>
                <th className="py-1.5 text-right font-normal">With Locke</th>
              </tr>
            </thead>
            <tbody>
              {preview.scenarios.map((sc) => (
                <tr key={sc.move} className="border-t border-line">
                  <td className={`py-1.5 ${sc.move < 0 ? "text-danger" : "text-ok"}`}>
                    {sc.move > 0 ? "+" : ""}
                    {pct(sc.move)}
                  </td>
                  <td className="hidden py-1.5 text-muted sm:table-cell">{price(sc.price)}</td>
                  <td className="py-1.5 text-right">{fmtOutcome(sc.without)}</td>
                  <td className="py-1.5 text-right">
                    {sc.liquidated ? <span className="text-danger">needs top-up first</span> : fmtOutcome(sc.with)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {type === "costs" && (
          <p className="mt-2 text-xs text-faint">
            Assumes {pct((inputs as CostsInputs).crudeSharePct / 100)} of the pump price moves with crude. Local prices also move with exchange
            rates, taxes and policy, which WTI doesn&apos;t capture.
          </p>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
        <Stat
          label="Locke asks for a top-up at"
          value={preview.alertPrice == null ? "Not needed" : price(preview.alertPrice)}
          sub={preview.alertPrice == null ? "margin covers any price move" : `${s.symbol} mark`}
        />
        <Stat
          label="Estimated liquidation"
          value={preview.liquidationPrice == null ? "None" : price(preview.liquidationPrice)}
          sub={preview.liquidationPrice == null ? "margin exceeds the hedge's value" : "before any top-up"}
          tone={preview.liquidationPrice == null ? "ok" : "bad"}
        />
      </div>
    </div>
  );
}
