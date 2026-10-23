import { NextResponse } from "next/server";
import { bech32Decode, isBech32Address } from "@/lib/cardano/bech32";
import { HttpError } from "@/lib/server/errors";
import { idParam, readJson, route } from "@/lib/server/http";
import { prepareDeposit } from "@/lib/server/planService";
import { LIMITS, rateLimit } from "@/lib/server/rateLimit";
import { requireSession } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

const MAX_UTXOS = 300;
const MAX_UTXO_HEX = 20_000;

/**
 * Same wallet: the signed-in address itself, or another base address of the same account
 * (multi-address wallets hand out several payment addresses sharing one stake credential).
 */
function sameWallet(address: string, signedIn: string): boolean {
  if (address === signedIn) return true;
  const a = bech32Decode(address);
  const b = bech32Decode(signedIn);
  const base = (d: Uint8Array) => d.length === 57 && d[0] >> 4 <= 3;
  if (a.hrp !== b.hrp || !base(a.data) || !base(b.data) || (a.data[0] & 0x0f) !== (b.data[0] & 0x0f)) return false;
  return a.data.subarray(29, 57).every((x, i) => x === b.data[29 + i]);
}

/** Quote and build the Cardano deposit for opening or topping up a plan. The wallet signs it in the browser. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession(req);
  const id = idParam((await ctx.params).id, "Plan not found");
  rateLimit(`${s.uid}:deposit`, LIMITS.strikeWrite);
  const body = await readJson(req);
  const purpose = body.purpose === "topup" ? "topup" : "open";
  // Change from the deposit goes back to this address, so it must belong to the wallet the user signed in with.
  const address = body.address == null ? s.addr : String(body.address);
  if (address.length > 200 || !isBech32Address(address)) throw new HttpError(400, "Invalid address");
  if (!sameWallet(address, s.addr)) throw new HttpError(403, "Deposit from the wallet you signed in with. Switch accounts in your wallet, or sign in again.");
  // Shape and size are checked here, before any Strike call; an empty list is allowed (prepareDeposit decides).
  const utxos = body.utxos ?? [];
  if (
    !Array.isArray(utxos) ||
    utxos.length > MAX_UTXOS ||
    utxos.some((u) => typeof u !== "string" || !u || u.length > MAX_UTXO_HEX || !/^[0-9a-f]+$/i.test(u))
  ) {
    throw new HttpError(400, "Invalid wallet UTxO list");
  }
  const result = await prepareDeposit(s.uid, id, purpose, {
    address,
    utxos: utxos as string[],
    amountUsd: body.amountUsd === undefined ? undefined : Number(body.amountUsd),
  });
  return NextResponse.json(result);
});
