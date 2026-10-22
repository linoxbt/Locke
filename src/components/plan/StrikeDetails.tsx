"use client";

import { Card, Stat } from "../ui";
import { usePlan } from "./PlanProvider";
import { CARDANOSCAN, num, pct, price, shortAddr, usd } from "@/lib/ui/format";

export function StrikeDetails() {
  const { detail: d } = usePlan();
  const p = d.plan;
  const pos = p.position;
  const rows: [string, string][] = [
    ["Market", p.symbol],
    ["Side", p.side === "sell" ? "Short" : "Long"],
    ["Size", pos ? num(pos.size, 4) : num(p.sizing.size, 4)],
    ["Entry", price(pos?.entry)],
    ["Mark", price(p.mark)],
    ["Leverage", `${pos?.leverage ?? p.sizing.leverage}x`],
    ["Margin mode", "Isolated"],
    ["Isolated balance", usd(pos?.isoBalance)],
    ["Maintenance margin", usd(pos?.maintenanceMargin)],
    ["Margin ratio", pct(p.ratio, 2)],
    ["Liquidation", pos && pos.liquidationPrice == null ? "None" : price(pos?.liquidationPrice)],
    ["Funding rate", `${pct(p.hourlyFundingRate, 4)}/h`],
    ["Builder fee", `${p.builderFeeBps} bps`],
    ["Opened", p.openedAt ? new Date(p.openedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"],
  ];
  return (
    <div className="space-y-3">
      <Card>
        <h2 className="display text-[20px]">Position on Strike</h2>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map(([k, v]) => (
            <Stat key={k} label={k} value={v} />
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="display text-[20px]">Deposits</h2>
        {d.deposits.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-3">No deposits for this plan.</p>
        ) : (
          <table className="num mt-6 w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="pb-3 font-normal">Purpose</th>
                <th className="pb-3 font-normal">Amount</th>
                <th className="hidden pb-3 font-normal sm:table-cell">Status</th>
                <th className="pb-3 text-right font-normal">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {d.deposits.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="py-3 capitalize">{x.purpose === "topup" ? "Top-up" : "Open"}</td>
                  <td className="py-3">{num(Number(x.lovelace) / 1e6, 2)} ADA</td>
                  <td className="hidden py-3 sm:table-cell">{x.status}</td>
                  <td className="py-3 text-right">
                    {x.tx_hash ? (
                      <a className="text-cobalt" href={`${CARDANOSCAN}${x.tx_hash}`} target="_blank" rel="noreferrer">
                        {shortAddr(x.tx_hash)} ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
