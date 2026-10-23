import { NextResponse } from "next/server";
import { addressToBech32, isBech32Address, stakeFromBaseAddress, bech32Decode } from "@/lib/cardano/bech32";
import { config } from "@/lib/server/config";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { clientIp, readJson, route, str } from "@/lib/server/http";
import { encryptSecret, generateApiWalletKeys } from "@/lib/server/secrets";
import { assertSameOrigin } from "@/lib/server/session";
import { requestBuilderSignature } from "@/lib/strike/client";

/** Sign-in attempts allowed per 10 minutes. Each one costs a Strike call and a stored keypair. */
const PER_IP = 20;
const PER_ADDRESS = 6;

/**
 * Step 1 of connect (= login). The server makes the user's Strike API wallet keypair,
 * asks Strike for a challenge, and keeps the encrypted key until the wallet signs.
 */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const address = str(body, "address", 200);
  const prefix = config.networkId === 1 ? "addr1" : "addr_test1";
  if (address !== address.toLowerCase() || !isBech32Address(address) || !address.startsWith(prefix)) {
    throw new HttpError(400, "Invalid Cardano address for this network");
  }
  // The stake address comes from the signed-in address itself, never from the browser.
  const stakeBytes = stakeFromBaseAddress(bech32Decode(address).data);
  const stakeAddress = stakeBytes ? addressToBech32(stakeBytes, config.networkId) : null;

  const sql = db();
  const ip = clientIp(req);
  await sql`delete from connect_challenges where created_at < now() - interval '10 minutes'`;
  const [counts] = await sql`
    select count(*) filter (where address = ${address})::int as by_address,
           count(*) filter (where ${ip}::text is not null and ip = ${ip})::int as by_ip
    from connect_challenges where created_at > now() - interval '10 minutes'`;
  if (counts.by_address >= PER_ADDRESS || counts.by_ip >= PER_IP) {
    throw new HttpError(429, "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const keys = generateApiWalletKeys();
  const feeShareBps = config.builderFeeBps;
  const challenge = await requestBuilderSignature({ address, publicKey: keys.publicKey, feeShareBps });

  await sql`
    insert into connect_challenges (nonce, address, stake_address, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps, ip)
    values (${challenge.nonce}, ${address}, ${stakeAddress}, ${keys.publicKey}, ${encryptSecret(keys.privateKey, keys.publicKey)}, ${feeShareBps}, ${ip})`;

  return NextResponse.json({ nonce: challenge.nonce, message: challenge.message_to_sign, feeShareBps });
});
