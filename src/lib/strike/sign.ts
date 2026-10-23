// Strike API wallet request signing (Node). Shared by the app server and the risk worker.
//
// Message: {METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{SHA256(body)}
// PATH includes "?query" when present; TIMESTAMP is unix seconds, never in the
// future and at most 3 minutes old.

import { createHash, createPrivateKey, randomUUID, sign, type KeyObject } from "node:crypto";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

// No cache: building the key object is cheap, and a cache keyed by the private key would keep
// plaintext keys in memory for the life of the process.
function keyObject(privateKeyHex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(privateKeyHex, "hex")]),
    format: "der",
    type: "pkcs8",
  });
}

export function ed25519SignHex(message: string, privateKeyHex: string): string {
  return sign(null, Buffer.from(message, "utf8"), keyObject(privateKeyHex)).toString("hex");
}

export function signRequestHeaders(
  method: string,
  path: string,
  body: string,
  keys: { publicKey: string; privateKey: string },
  nowMs: number
): Record<string, string> {
  // One second back so a slightly fast local clock never produces a "future" timestamp.
  const timestamp = String(Math.floor(nowMs / 1000) - 1);
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const message = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${bodyHash}`;
  return {
    "X-API-Wallet-Public-Key": keys.publicKey,
    "X-API-Wallet-Signature": ed25519SignHex(message, keys.privateKey),
    "X-API-Wallet-Timestamp": timestamp,
    "X-API-Wallet-Nonce": nonce,
  };
}

/** session.logon for the user WebSocket: "session.logon:{timestamp_ms}:{apiKey}". */
export function signLogon(keys: { publicKey: string; privateKey: string }, nowMs: number) {
  const timestamp = nowMs;
  const signature = ed25519SignHex(`session.logon:${timestamp}:${keys.publicKey}`, keys.privateKey);
  return { apiKey: keys.publicKey, signature, timestamp };
}
