"use client";

import type { CostsInputs, HoldingsInputs, PlanType, Preview } from "@/lib/domain/types";
import { localCompact, num, pct, price, signedUsd, usd } from "@/lib/ui/format";
import { Card, Eyebrow, Stat, SUBTLE } from "./ui";

export function hedgeInWords(type: PlanType, p: Preview): { lead: string; rest: string } {
  const s = p.sizing;
  if (type === "holdings") {
    return { lead: `Locke sells ${num(s.size, 0)} ADA on Strike.`, rest: "If ADA falls, the hedge gains what your treasury loses." };
  }
  return { lead: `Locke buys ${num(s.size, 2)} WTI on Strike.`, rest: "If crude rises, the hedge gains and pays down your fuel bill." };
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
  const fmt = (n: number) => (type === "holdings" ? usd(n, 0) : localCompact(n, cur));
  const marginAda = adaPrice ? s.requiredUsd / adaPrice : null;
  const noFunding = Math.abs(preview.fundingPerDayUsd) < 0.005;
  const words = hedgeInWords(type, preview);
  const tone = type === "holdings" ? "cobalt" : "lime";
  const maxAbs = Math.max(...preview.scenarios.map((x) => Math.max(Math.abs(x.without), Math.abs(x.with))));

  return (
    <div className="space-y-3">
      <Card tone={tone} className="sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow className={SUBTLE[tone]}>{preview.label}</Eyebrow>
          <span className={`num rounded-full px-3 py-1 text-[12px] ${tone === "cobalt" ? "bg-paper/15" : "bg-ink/10"}`}>
            {s.symbol} · {s.side === "sell" ? "short" : "long"} · {s.leverage}x
          </span>
        </div>
        <p className="display mt-10 max-w-[22ch] text-[32px] sm:text-[48px]">
          {words.lead} <span className={SUBTLE[tone]}>{words.rest}</span>
        </p>
        <div className={`mt-10 grid grid-cols-2 gap-6 border-t pt-6 sm:grid-cols-4 ${tone === "cobalt" ? "border-paper/20" : "border-ink/15"}`}>
          <Stat subtle={SUBTLE[tone]} label="Hedge size" value={`${num(s.size, type === "holdings" ? 0 : 2)} ${type === "holdings" ? "ADA" : "WTI"}`} sub={usd(s.notional)} />
          <Stat subtle={SUBTLE[tone]} label="Margin to deposit" value={usd(s.requiredUsd)} sub={marginAda ? `≈ ${num(marginAda, 0)} ADA` : undefined} />
          <Stat subtle={SUBTLE[tone]} label="Opening cost" value={usd(s.openFeeUsd)} sub="taker + builder fee" />
          <Stat
            subtle={SUBTLE[tone]}
            label="Cost of protection"
            value={noFunding ? "$0.00" : signedUsd(preview.fundingPerDayUsd)}
            sub={noFunding ? "funding is flat today" : `per day, ${preview.fundingPerDayUsd >= 0 ? "received" : "paid"}`}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="display text-[24px]">{type === "holdings" ? "Treasury value" : "Monthly fuel bill"}</h3>
            <span className="text-[13px] text-ink-3">{type === "holdings" ? "USD" : `${cur}, crude-share model`}</span>
          </div>
          <table className="num mt-6 w-full text-[15px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="pb-3 font-normal">{type === "holdings" ? "ADA" : "Crude"}</th>
                <th className="pb-3 text-right font-normal">Without Locke</th>
                <th className="pb-3 text-right font-normal">With Locke</th>
              </tr>
            </thead>
            <tbody>
              {preview.scenarios.map((sc) => (
                <tr key={sc.move} className="border-t border-line">
                  <td className={`py-3 ${sc.move < 0 ? "text-danger" : "text-ok"}`}>
                    {sc.move > 0 ? "+" : ""}
                    {pct(sc.move)}
                  </td>
                  <td className="py-3 text-right text-ink-2">
                    <span className="inline-flex items-center justify-end gap-3">
                      <span className="hidden h-1.5 rounded-full bg-mist sm:inline-block" style={{ width: `${(Math.abs(sc.without) / maxAbs) * 72}px` }} />
                      {fmt(sc.without)}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {sc.liquidated ? (
                      <span className="text-danger">top-up first</span>
                    ) : (
                      <span className="inline-flex items-center justify-end gap-3">
                        <span className={`hidden h-1.5 rounded-full sm:inline-block ${type === "holdings" ? "bg-cobalt" : "bg-ink"}`} style={{ width: `${(Math.abs(sc.with) / maxAbs) * 72}px` }} />
                        {fmt(sc.with)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {type === "costs" && (
            <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
              Assumes {pct((inputs as CostsInputs).crudeSharePct / 100)} of the pump price moves with crude. Local prices also move with
              exchange rates, taxes and policy, which WTI doesn&apos;t capture.
            </p>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3">
          <Card tone="mist">
            <Eyebrow className="text-ink-2">Locke asks for a top-up at</Eyebrow>
            <div className="num mt-6 text-[32px] leading-none">{preview.alertPrice == null ? "Not needed" : price(preview.alertPrice)}</div>
            <p className="mt-2 text-[13px] text-ink-2">{preview.alertPrice == null ? "Margin covers any price move" : `${s.symbol} mark`}</p>
          </Card>
          <Card tone={preview.liquidationPrice == null ? "mist" : "ink"}>
            <Eyebrow className={preview.liquidationPrice == null ? "text-ink-2" : SUBTLE.ink}>Estimated liquidation</Eyebrow>
            <div className={`num mt-6 text-[32px] leading-none ${preview.liquidationPrice == null ? "text-ok" : ""}`}>
              {preview.liquidationPrice == null ? "None" : price(preview.liquidationPrice)}
            </div>
            <p className={`mt-2 text-[13px] ${preview.liquidationPrice == null ? "text-ink-2" : SUBTLE.ink}`}>
              {preview.liquidationPrice == null ? "Margin exceeds the hedge's value" : "Before any top-up"}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
