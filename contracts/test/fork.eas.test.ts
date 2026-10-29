/**
 * "Protected by Locke" attestations against the real EAS predeploys on a Base mainnet fork: the
 * schema id the app computes is the one EAS assigns, the keeper can attest to a vault owner, anyone
 * can read and decode it, and revoking it marks it revoked. Run with:
 * FORK=1 npx hardhat test test/fork.eas.test.ts
 */
import hre from "hardhat";
import { expect } from "chai";
import { parseEventLogs, zeroAddress, type Hex } from "viem";
import {
  decodeProtection,
  EAS_ADDRESS,
  easAbi,
  PROTECTION_SCHEMA,
  PROTECTION_SCHEMA_UID,
  protectionRequest,
  SCHEMA_REGISTRY_ADDRESS,
  schemaRegistryAbi,
} from "../../src/lib/base/attest";

describe("Protected by Locke on EAS (Base fork)", function () {
  before(function () {
    if (!process.env.FORK) this.skip();
  });

  it("registers the schema, attests to the owner, reads it back and revokes it", async function () {
    const pub = await hre.viem.getPublicClient();
    const [keeper, owner] = await hre.viem.getWalletClients();
    const vault = "0x1111111111111111111111111111111111111111";

    // The schema may already be registered on Base; register it only if EAS doesn't know it.
    const known = await pub.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "getSchema", args: [PROTECTION_SCHEMA_UID] });
    if (known.uid === `0x${"0".repeat(64)}`) {
      const hash = await keeper.writeContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "register", args: [PROTECTION_SCHEMA, zeroAddress, true] });
      await pub.waitForTransactionReceipt({ hash });
    }
    const schema = await pub.readContract({ address: SCHEMA_REGISTRY_ADDRESS, abi: schemaRegistryAbi, functionName: "getSchema", args: [PROTECTION_SCHEMA_UID] });
    expect(schema.uid).to.equal(PROTECTION_SCHEMA_UID);
    expect(schema.schema).to.equal(PROTECTION_SCHEMA);
    expect(schema.revocable).to.equal(true);

    const startedAt = 1_793_300_000;
    const hash = await keeper.writeContract({
      address: EAS_ADDRESS,
      abi: easAbi,
      functionName: "attest",
      args: [protectionRequest(owner.account.address, { vault, market: "ETH/USD", long: false, protectedUsd: 341.5, startedAt })],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: easAbi, logs: receipt.logs, eventName: "Attested" });
    const uid = ev.args.uid as Hex;

    const a = await pub.readContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "getAttestation", args: [uid] });
    expect(a.schema).to.equal(PROTECTION_SCHEMA_UID);
    expect(a.attester.toLowerCase()).to.equal(keeper.account.address.toLowerCase());
    expect(a.recipient.toLowerCase()).to.equal(owner.account.address.toLowerCase());
    expect(a.revocationTime).to.equal(0n);
    expect(decodeProtection(a.data)).to.deep.equal({ vault, market: "ETH/USD", long: false, protectedUsd: 341.5, startedAt });

    // Only the attester can revoke.
    let refused = false;
    try {
      await owner.writeContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "revoke", args: [{ schema: PROTECTION_SCHEMA_UID, data: { uid, value: 0n } }] });
    } catch {
      refused = true;
    }
    expect(refused, "a stranger revoked Locke's attestation").to.equal(true);

    await pub.waitForTransactionReceipt({
      hash: await keeper.writeContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "revoke", args: [{ schema: PROTECTION_SCHEMA_UID, data: { uid, value: 0n } }] }),
    });
    const after = await pub.readContract({ address: EAS_ADDRESS, abi: easAbi, functionName: "getAttestation", args: [uid] });
    expect(after.revocationTime > 0n).to.equal(true);
    console.log(`      schema ${PROTECTION_SCHEMA_UID} ${known.uid === PROTECTION_SCHEMA_UID ? "(already on Base)" : "(registered on the fork)"}; attestation ${uid}`);
  });
});
