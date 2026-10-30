// Reads a "Protected by Locke" attestation from EAS on Base for the public proof page.

import { type Address, type Hex } from "viem";
import { decodeProtection, EAS_ADDRESS, easAbi, PROTECTION_SCHEMA_UID, UID, type Protection } from "../base/attest";
import { basePublicClient } from "./baseChain";
import { factoryAbi } from "../base/contracts";
import { config } from "./config";

export type ProofStatus =
  /** Issued by Locke's keeper and not revoked: the hedge is open. */
  | "protected"
  /** Revoked: the vault has closed. */
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

/** Locke's keeper, plus any earlier keepers listed in BASE_PAST_KEEPERS (comma-separated). */
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
  const status = proofStatus(a, keepers);
  let protection: Protection | null = null;
  if (status !== "other") {
    try {
      protection = decodeProtection(a.data);
    } catch {
      protection = null;
    }
  }
  return {
    uid: a.uid.toLowerCase(),
    status,
    protection,
    owner: a.recipient.toLowerCase(),
    attester: a.attester.toLowerCase(),
    issuedAt: Number(a.time),
    endedAt: a.revocationTime > 0n ? Number(a.revocationTime) : null,
  };
}
