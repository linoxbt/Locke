import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { addressToBech32, isBech32Address, stakeFromBaseAddress, bech32Decode } from "@/lib/cardano/bech32";
import { config } from "@/lib/server/config";
import { strikeConnect } from "@/lib/server/connect";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { clientIp, readJson, route, str } from "@/lib/server/http";
import { ipBucket } from "@/lib/server/rateLimit";
import { encryptSecret, generateApiWalletKeys } from "@/lib/server/secrets";
import { assertSameOrigin } from "@/lib/server/session";
import { requestBuilderSignature } from "@/lib/strike/client";

/**
 * Sign-in attempts. Each one costs a Strike call under Locke's builder code and a stored keypair.
 * Per network (IPv4 /24, IPv6 /64) per 10 minutes, and for everyone together per minute. There is
 * no per-address cap: anyone can type anyone's address, so it would only let strangers lock a
 * wallet out.
 */
const PER_NETWORK = 20;
const GLOBAL_PER_MINUTE = 120;
const TOO_MANY = "Too many sign-in attempts. Wait a few minutes and try again.";

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
  // Display only: the signature proves the payment key, not the stake part of a base address, so
  // nothing may treat this as proven ownership of the stake key (the UI labels it as such).
  const stakeBytes = stakeFromBaseAddress(bech32Decode(address).data);
  const stakeAddress = stakeBytes ? addressToBech32(stakeBytes, config.networkId) : null;

  const sql = db();
  // connect_challenges.ip holds the caller's network bucket ("203.0.113.0/24", "2001:db8:0:1::/64"), not the raw IP.
  const network = ipBucket(clientIp(req));
  const keys = generateApiWalletKeys();
  const feeShareBps = config.builderFeeBps;
  // Reserve the attempt under a lock before calling Strike, so parallel requests are counted
  // one after another and can't all slip under the limits. The row gets Strike's nonce below.
  const reserved = `pending:${randomUUID()}`;
  await sql`delete from connect_challenges where created_at < now() - interval '10 minutes'`;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('locke:connect-start'))`;
    const [counts] = await tx`
      select count(*) filter (where created_at > now() - interval '1 minute')::int as global,
             count(*) filter (where ${network}::text is not null and ip = ${network})::int as by_network
      from connect_challenges where created_at > now() - interval '10 minutes'`;
    if (counts.global >= GLOBAL_PER_MINUTE || counts.by_network >= PER_NETWORK) throw new HttpError(429, TOO_MANY);
    await tx`
      insert into connect_challenges (nonce, address, stake_address, api_wallet_public_key, api_wallet_secret_enc, fee_share_bps, ip)
      values (${reserved}, ${address}, ${stakeAddress}, ${keys.publicKey}, ${encryptSecret(keys.privateKey, keys.publicKey)}, ${feeShareBps}, ${network})`;
  });

  // A failed call keeps its reservation: it still cost a Strike request and still counts.
  const challenge = await strikeConnect(requestBuilderSignature({ address, publicKey: keys.publicKey, feeShareBps }));
  if (typeof challenge.nonce !== "string" || !challenge.nonce || challenge.nonce.length > 200 || typeof challenge.message_to_sign !== "string") {
    throw new HttpError(502, "Strike returned an unusable sign-in challenge");
  }
  // The exact message is kept so /finish can check the wallet signed this and nothing else.
  await sql`
    update connect_challenges set nonce = ${challenge.nonce}, message = ${challenge.message_to_sign}
    where nonce = ${reserved}`;

  return NextResponse.json({ nonce: challenge.nonce, message: challenge.message_to_sign, feeShareBps });
});
