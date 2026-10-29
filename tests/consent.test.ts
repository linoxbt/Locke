import { describe, expect, it } from "vitest";
import { parseConsent, serializeConsent } from "@/lib/consent";
import { contactEmail, LEGAL_DOCS, operatorName } from "@/lib/legal";

describe("cookie consent", () => {
  it("round-trips a choice", () => {
    expect(parseConsent(serializeConsent({ preferences: true, at: 1793300000 }))).toEqual({ preferences: true, at: 1793300000 });
    expect(parseConsent(serializeConsent({ preferences: false, at: 1793300000.7 }))).toEqual({ preferences: false, at: 1793300000 });
  });

  it("treats anything else as no choice yet, so the notice shows again", () => {
    for (const v of [undefined, null, "", "yes", "v0.p1.1793300000", "v1.p2.1793300000", "v1.p1.", "v1.p1.abc", "v1.p1.1793300000;x"]) {
      expect(parseConsent(v)).toBeNull();
    }
  });
});

describe("legal settings", () => {
  it("shows a visible placeholder until the operator details are filled in", () => {
    expect(operatorName()).toMatch(/^\[.+\]$|^[^[]/);
    expect(contactEmail()).toMatch(/^\[contact email\]$|@/);
  });

  it("lists the four documents under /legal", () => {
    expect(LEGAL_DOCS.map((d) => d.href)).toEqual(["/legal/terms", "/legal/privacy", "/legal/cookies", "/legal/risk"]);
  });
});
