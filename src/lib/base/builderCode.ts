import { Attribution } from "ox/erc8021";
import type { Hex } from "viem";

/**
 * The ERC-8021 data suffix that credits a transaction to Locke's Base Builder Code. Appended to the
 * calldata of every transaction the app or keeper sends; contracts ignore the extra bytes.
 */
export function builderSuffix(code: string | null | undefined): Hex | undefined {
  return code ? (Attribution.toDataSuffix({ codes: [code] }) as Hex) : undefined;
}
