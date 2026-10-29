// "Protected by Locke": an Ethereum Attestation Service (EAS) attestation on Base for each vault
// whose hedge is open. Locke's keeper issues it when the hedge opens and revokes it when the vault
// closes, so anyone can check on Base (or on easscan.org) that a business's holdings or fuel
// budget are protected, how much, on which market and since when.
//
// EAS and its schema registry are predeploys on Base (OP Stack). The schema's id is fixed by its
// text, so the keeper can register it once on first run and everyone can compute it.

import { decodeAbiParameters, encodeAbiParameters, encodePacked, keccak256, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";

export const EAS_ADDRESS: Address = "0x4200000000000000000000000000000000000021";
export const SCHEMA_REGISTRY_ADDRESS: Address = "0x4200000000000000000000000000000000000020";

/** What each attestation records. Amounts are USDC units (6 decimals). */
export const PROTECTION_SCHEMA = "address vault,string market,bool long,uint256 protectedUsd,uint64 startedAt";
const PARAMS = parseAbiParameters(PROTECTION_SCHEMA);

/** The schema's id on EAS: keccak256(schema, resolver, revocable). No resolver; revocable. */
export const PROTECTION_SCHEMA_UID: Hex = keccak256(encodePacked(["string", "address", "bool"], [PROTECTION_SCHEMA, zeroAddress, true]));

export interface Protection {
  vault: Address;
  /** Market symbol, e.g. "ETH/USD". */
  market: string;
  /** true when the hedge is long (fuel costs), false when short (holdings). */
  long: boolean;
  /** Hedge size in USD. */
  protectedUsd: number;
  /** When the hedge opened (unix seconds). */
  startedAt: number;
}

export function encodeProtection(p: Protection): Hex {
  return encodeAbiParameters(PARAMS, [p.vault, p.market, p.long, BigInt(Math.round(p.protectedUsd * 1e6)), BigInt(Math.floor(p.startedAt))]);
}

export function decodeProtection(data: Hex): Protection {
  const [vault, market, long, usd, startedAt] = decodeAbiParameters(PARAMS, data);
  return { vault, market, long, protectedUsd: Number(usd) / 1e6, startedAt: Number(startedAt) };
}

export const easAbi = parseAbi([
  "struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }",
  "struct AttestationRequest { bytes32 schema; AttestationRequestData data; }",
  "struct RevocationRequestData { bytes32 uid; uint256 value; }",
  "struct RevocationRequest { bytes32 schema; RevocationRequestData data; }",
  "struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }",
  "function attest(AttestationRequest request) payable returns (bytes32)",
  "function revoke(RevocationRequest request) payable",
  "function getAttestation(bytes32 uid) view returns (Attestation)",
  "event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)",
]);

export const schemaRegistryAbi = parseAbi([
  "struct SchemaRecord { bytes32 uid; address resolver; bool revocable; string schema; }",
  "function register(string schema, address resolver, bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns (SchemaRecord)",
]);

/** The attestation as it should be sent for a vault: to its owner, no expiry, revocable. */
export function protectionRequest(owner: Address, p: Protection) {
  return {
    schema: PROTECTION_SCHEMA_UID,
    data: { recipient: owner, expirationTime: 0n, revocable: true, refUID: `0x${"0".repeat(64)}` as Hex, data: encodeProtection(p), value: 0n },
  };
}

/** The public page and the explorer view for an attestation. */
export const proofPath = (uid: string) => `/proof/${uid.toLowerCase()}`;
export const easscanUrl = (uid: string) => `https://base.easscan.org/attestation/view/${uid.toLowerCase()}`;

export const UID = /^0x[0-9a-fA-F]{64}$/;
