import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/server/emailTemplate";
import { ownerNotice } from "@/lib/server/planService";
import { renderTelegram } from "@/lib/server/telegramTemplate";

describe("Owner alerts", () => {
  it("sends the events an owner needs, not the routine ones", () => {
    expect(ownerNotice("info", "Hedge open on Strike: 1000 ADA-USD at 0.71")).toEqual({ headline: "your hedge is open", tone: "ok" });
    expect(ownerNotice("info", "Plan closed. Margin is back on your Strike balance.")).toEqual({ headline: "plan closed", tone: "info" });
    expect(ownerNotice("action", "Could not open the hedge: rejected")?.tone).toBe("watch");
    expect(ownerNotice("liquidation", "The position is no longer open on Strike")?.tone).toBe("danger");
    expect(ownerNotice("info", "Deposit credited on Strike: $50.00")).toBeNull();
    expect(ownerNotice("watch", "The hedge filled partly")).toBeNull();
  });

  it("renders branded email and Telegram messages with escaped content", () => {
    const c = { preheader: "x", eyebrow: "ADA treasury", title: "Margin call <now>", paragraphs: ["Top up & stay safe"], cta: { label: "View plan", url: "https://trylocke.online/plans/1" }, tone: "danger" as const };
    const e = renderEmail(c);
    expect(e.html).toContain("Margin call &lt;now&gt;");
    expect(e.text).toContain("View plan: https://trylocke.online/plans/1");
    const t = renderTelegram(c);
    expect(t.text).toContain("🔴 Urgent");
    expect(t.text).toContain("Top up &amp; stay safe");
    expect(t.button?.url).toBe("https://trylocke.online/plans/1");
  });
});
