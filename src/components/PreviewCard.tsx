"use client";

import { fillProblem, WARN_SLIPPAGE, type FillEstimate } from "@/lib/domain/liquidity";
import type { CostsInputs, HoldingsInputs, PlanType, Preview } from "@/lib/domain/types";
import { COUNTRIES, FUELS, fxBillImpact } from "@/lib/domain/fuel";
import { local, localCompact, num, pct, price, signedUsd, usd } from "@/lib/ui/format";
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
      <Card tone={tone} className="sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow className={SUBTLE[tone]}>{preview.label}</Eyebrow>
          <span className={`num rounded-full px-3 py-1 text-[12px] ${tone === "cobalt" ? "bg-paper/15" : "bg-ink/10"}`}>
            {s.symbol} · protects against a {s.side === "sell" ? "fall" : "rise"} · {s.leverage}x
          </span>
        </div>
        <p className="display mt-7 max-w-[22ch] text-[21px] sm:text-[26px]">
          {words.lead} <span className={SUBTLE[tone]}>{words.rest}</span>
        </p>
        <div className={`mt-7 grid grid-cols-2 gap-6 border-t pt-6 sm:grid-cols-4 ${tone === "cobalt" ? "border-paper/20" : "border-ink/15"}`}>
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
        {preview.execution && <ExecutionLine est={preview.execution} dark={tone === "cobalt"} />}
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="display text-[17px]">{type === "holdings" ? "Treasury value" : "Monthly fuel bill"}</h3>
            <span className="text-[13px] text-ink-3">{type === "holdings" ? "USD" : `${cur}, crude-share model`}</span>
          </div>
          <table className="num mt-6 w-full text-[14px]">
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
          {type === "costs" && <CostsNotes c={inputs as CostsInputs} />}
        </Card>

        <div className="grid grid-cols-1 gap-3">
          <Card tone="mist">
            <Eyebrow className="text-ink-2">Locke asks for a top-up at</Eyebrow>
            <div className="num mt-6 text-[21px] leading-none">{preview.alertPrice == null ? "Not needed" : price(preview.alertPrice)}</div>
            <p className="mt-2 text-[13px] text-ink-2">{preview.alertPrice == null ? "Margin covers any price move" : `${s.symbol} mark`}</p>
          </Card>
          <Card tone={preview.liquidationPrice == null ? "mist" : "ink"}>
            <Eyebrow className={preview.liquidationPrice == null ? "text-ink-2" : SUBTLE.ink}>Estimated liquidation</Eyebrow>
            <div className={`num mt-6 text-[21px] leading-none ${preview.liquidationPrice == null ? "text-ok" : ""}`}>
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

/** Estimated market fill from Strike's order book, with a caution when it would cost noticeably more than the mark. */
function ExecutionLine({ est, dark }: { est: FillEstimate; dark: boolean }) {
  const problem = fillProblem(est);
  const slip = est.slippage ?? 0;
  const cost = slip <= 0.0001 ? "at the mark" : `${(slip * 100).toFixed(2)}% over the mark`;
  const tone = problem ? "bg-danger text-paper" : slip > WARN_SLIPPAGE ? "bg-watch text-ink" : dark ? "bg-paper/15" : "bg-ink/10";
  return (
    <p className={`num mt-6 rounded-xl px-4 py-3 text-[13px] leading-relaxed ${tone}`}>
      {problem ??
        `Estimated fill ${est.avgPrice != null ? price(est.avgPrice) : "—"}, ${cost}, across ${est.levels} price level${est.levels === 1 ? "" : "s"} of Strike's order book.`}
    </p>
  );
}

/** What the costs preview assumes, the budget it was sized for, and the currency risk it leaves open. */
function CostsNotes({ c }: { c: CostsInputs }) {
  const cover = c.coverPct ?? 100;
  return (
    <div className="mt-4 space-y-3 text-[13px] leading-relaxed">
      <p className="text-ink-3">
        {FUELS[c.fuelType]?.label ?? "Fuel"}
        {c.country ? ` in ${COUNTRIES[c.country].name}` : ""}. Assumes {pct(c.crudeSharePct / 100)} of the pump price moves with crude
        {cover < 100 ? `, and hedges ${cover}% of that` : ""}.
        {c.budget
          ? ` Sized so the bill stays under ${local(c.budget.monthlyMax, c.currency, 0)} a month if crude rises ${c.budget.stressPct}%.`
          : ""}
      </p>
      <p className="rounded-xl bg-watch/25 p-3 text-ink">
        <span className="font-medium">Not covered: the exchange rate.</span> If the {c.currency} weakens 10% against the dollar, this bill rises about{" "}
        {local(fxBillImpact(c, 10), c.currency, 0)} a month even if crude doesn&apos;t move. Taxes and policy changes aren&apos;t covered either.
      </p>
    </div>
  );
}
