// Reads a "Protected by Locke" attestation from EAS on Base for the public proof page.

import { isAddressEqual, type Address, type Hex } from "viem";
import { decodeProtection, EAS_ADDRESS, easAbi, PROTECTION_SCHEMA_UID, UID, type Protection } from "../base/attest";
import { basePublicClient } from "./baseChain";
import { factoryAbi, vaultAbi } from "../base/contracts";
import { config } from "./config";
import { db } from "./db";

export type ProofStatus =
  /** Issued by Locke's keeper and not revoked: the hedge is open. */
  | "protected"
  /** Revoked, or its vault has closed or changed hands: the protection is over. */
  | "ended"
  /** A Locke-shaped attestation from someone who isn't Locke's keeper. */
  | "unverified"
  /** Some other attestation, not a Locke proof at all. */
  | "other";

export interface Proof {
  uid: string;
  status: ProofStatus;
  protection: Protection | null;
  owner: string;
  attester: string;
  issuedAt: number;
  endedAt: number | null;
  /**
   * Why an unrevoked proof reads as ended: its vault closed (revoked shortly, or never if an
   * earlier keeper key issued it: "issuer-retired"), or the vault has another owner now.
   */
  endedBecause?: "closed" | "issuer-retired" | "owner-changed";
}

/**
 * What Locke's records and the vault on Base add to the attestation's own status: a Locke proof
 * names one of the factory's vaults, issued to its owner, and holds only while the vault is open.
 */
export function checkedStatus(
  status: ProofStatus,
  f: { factoryVault: boolean | null; ownerMatches: boolean | null; vaultClosed: boolean; issuerRetired: boolean }
): { status: ProofStatus; endedBecause?: Proof["endedBecause"] } {
  if (status !== "protected" && status !== "ended") return { status };
  if (f.factoryVault === false) return { status: "unverified" };
  if (status === "ended") return { status };
  if (f.vaultClosed) return { status: "ended", endedBecause: f.issuerRetired ? "issuer-retired" : "closed" };
  if (f.ownerMatches === false) return { status: "ended", endedBecause: "owner-changed" };
  return { status };
}

interface RawAttestation {
  uid: Hex;
  schema: Hex;
  time: bigint;
  revocationTime: bigint;
  recipient: Address;
  attester: Address;
  data: Hex;
}

/** What the page says about an attestation. `issuers` are Locke's keeper addresses (lowercase); empty when unknown. */
export function proofStatus(a: Pick<RawAttestation, "schema" | "revocationTime" | "attester">, issuers: string[]): ProofStatus {
  if (a.schema.toLowerCase() !== PROTECTION_SCHEMA_UID.toLowerCase()) return "other";
  if (!issuers.includes(a.attester.toLowerCase())) return "unverified";
  return a.revocationTime > 0n ? "ended" : "protected";
}

/** Locke's keeper first, then any earlier keepers listed in BASE_PAST_KEEPERS (comma-separated). */
async function issuers(): Promise<string[]> {
  const past = (process.env.BASE_PAST_KEEPERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
  const factory = config.baseFactoryAddress;
  if (!factory) return past;
  // Read here rather than with a fallback: if Base can't answer, the page says so instead of
  // calling a genuine proof "not issued by Locke".
  const current = (await basePublicClient().readContract({ address: factory, abi: factoryAbi, functionName: "keeper" })) as string;
  return [current.toLowerCase(), ...past];
}

/** The proof, or null when the id is malformed or EAS has no such attestation. */
export async function readProof(uid: string): Promise<Proof | null> {
  if (!UID.test(uid)) return null;
  const [a, keepers] = await Promise.all([
    basePublicClient().readContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "getAttestation", args: [uid as Hex] }) as Promise<RawAttestation>,
    issuers(),
  ]);
  if (/^0x0+$/.test(a.uid)) return null;
  let status = proofStatus(a, keepers);
  let protection: Protection | null = null;
  if (status !== "other") {
    try {
      protection = decodeProtection(a.data);
    } catch {
      protection = null;
    }
  }
  let endedAt = a.revocationTime > 0n ? Number(a.revocationTime) : null;
  let endedBecause: Proof["endedBecause"];
  if (status === "protected" || status === "ended") {
    if (!protection) status = "unverified";
    else {
      const vault = await vaultFacts(protection.vault, a.recipient);
      ({ status, endedBecause } = checkedStatus(status, { ...vault, issuerRetired: !!config.baseFactoryAddress && a.attester.toLowerCase() !== keepers[0] }));
      // Not revoked, so EAS has no end time: the vault's close, or (changed hands, when unknown) now.
      if (endedBecause) endedAt = vault.closedAt ?? Math.floor(Date.now() / 1000);
    }
  }
  return {
    uid: a.uid.toLowerCase(),
    status,
    protection,
    owner: a.recipient.toLowerCase(),
    attester: a.attester.toLowerCase(),
    issuedAt: Number(a.time),
    endedAt,
    ...(endedBecause ? { endedBecause } : {}),
  };
}

/**
 * The vault the proof names: one of the factory's, owned by the proof's recipient (null when Locke
 * isn't live), and whether Locke has it as closed. Locke's records unreadable: taken as open,
 * since the attestation itself is still on Base.
 */
async function vaultFacts(vault: Address, recipient: Address) {
  const factory = config.baseFactoryAddress;
  const client = basePublicClient();
  const factoryVault = factory ? ((await client.readContract({ address: factory, abi: factoryAbi, functionName: "isVault", args: [vault] })) as boolean) : null;
  const owner = factoryVault ? ((await client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" })) as Address) : null;
  const [row] = await db()`select status, closed_at from base_vaults where address = ${vault.toLowerCase()}`.catch(() => []);
  return {
    factoryVault,
    ownerMatches: owner ? isAddressEqual(owner, recipient) : null,
    vaultClosed: row?.status === "closed",
    closedAt: row?.closed_at ? Math.floor(new Date(row.closed_at).getTime() / 1000) : null,
  };
}
