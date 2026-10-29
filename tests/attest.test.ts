import { describe, expect, it } from "vitest";
import { decodeProtection, easscanUrl, encodeProtection, PROTECTION_SCHEMA_UID, proofPath } from "@/lib/base/attest";
import { proofStatus } from "@/lib/server/baseProof";

const KEEPER = "0x00000000000000000000000000000000000000aa";

describe("Protected by Locke attestations", () => {
  it("uses the schema id EAS assigns on Base (checked on a Base fork in contracts/test/fork.eas.test.ts)", () => {
    expect(PROTECTION_SCHEMA_UID).toBe("0x0105cb441864a37f9dcfce9f7b184ee70281d117c0cbe6d1a7c09e7079d38a7c");
  });

  it("round-trips what a proof records, in USDC units", () => {
    const p = { vault: "0x1111111111111111111111111111111111111111" as const, market: "WTI/USD", long: true, protectedUsd: 1234.567891, startedAt: 1793300000 };
    expect(decodeProtection(encodeProtection(p))).toEqual({ ...p, protectedUsd: 1234.567891 });
    expect(decodeProtection(encodeProtection({ ...p, protectedUsd: 0.0000004 })).protectedUsd).toBe(0);
  });

  it("only calls a proof Locke's when Locke's keeper issued it, and ended once revoked", () => {
    const ours = { schema: PROTECTION_SCHEMA_UID, revocationTime: 0n, attester: KEEPER as `0x${string}` };
    expect(proofStatus(ours, [KEEPER])).toBe("protected");
    expect(proofStatus({ ...ours, attester: "0x00000000000000000000000000000000000000AA" }, [KEEPER])).toBe("protected");
    expect(proofStatus({ ...ours, revocationTime: 1793400000n }, [KEEPER])).toBe("ended");
    expect(proofStatus({ ...ours, attester: "0x00000000000000000000000000000000000000bb" }, [KEEPER])).toBe("unverified");
    expect(proofStatus(ours, [])).toBe("unverified");
    expect(proofStatus({ ...ours, schema: `0x${"1".repeat(64)}` }, [KEEPER])).toBe("other");
  });

  it("links to the public page and to EAS Scan", () => {
    const uid = `0x${"AB".repeat(32)}`;
    expect(proofPath(uid)).toBe(`/proof/0x${"ab".repeat(32)}`);
    expect(easscanUrl(uid)).toBe(`https://base.easscan.org/attestation/view/0x${"ab".repeat(32)}`);
  });
});
