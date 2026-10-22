import { NextResponse } from "next/server";
import { isBech32Address, isBech32Stake } from "@/lib/cardano/bech32";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { readJson, route } from "@/lib/server/http";
import { encryptSecret, generateApiWalletKeys } from "@/lib/server/secrets";
import { assertSameOrigin } from "@/lib/server/session";
import { requestBuilderSignature } from "@/lib/strike/client";

/**
 * Step 1 of connect (= login). The server makes the user's Strike API wallet keypair,
 * asks Strike for a challenge, and keeps the encrypted key until the wallet signs.
 */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const address = String(body.address ?? "");
  const stakeAddress = body.stakeAddress ? String(body.stakeAddress) : null;
  const prefix = config.networkId === 1 ? "addr1" : "addr_test1";
  if (!isBech32Address(address) || !address.startsWith(prefix)) throw new HttpError(400, "Invalid Cardano address for this network");
  if (stakeAddress && !isBech32Stake(stakeAddress)) throw new HttpError(400, "Invalid stake address");

  const keys = generateApiWalletKeys();
  const feeShareBps = config.builderFeeBps;
  const challenge = await requestBuilderSignature({ address, publicKey: keys.publicKey, feeShareBps });

  const sql = db();
  await sql`delete from connect_challenges where created_at < now() - interval '10 minutes'`;
  await sql`
    insert into connect_challenges (nonce, address, stake_address, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps)
    values (${challenge.nonce}, ${address}, ${stakeAddress}, ${keys.publicKey}, ${encryptSecret(keys.privateKey)}, ${feeShareBps})`;

  return NextResponse.json({ nonce: challenge.nonce, message: challenge.message_to_sign, feeShareBps });
});
