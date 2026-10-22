import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import { config } from "./config";

/** AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext>, base64url. */
export function encryptSecret(plain: string, key: Buffer = config.keyEnc): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string, key: Buffer = config.keyEnc): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export interface Ed25519Keys {
  publicKey: string; // 64 hex
  privateKey: string; // 64 hex (seed)
}

/** Generated on the server; the private key never reaches the browser or the logs. */
export function generateApiWalletKeys(): Ed25519Keys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "jwk" }).x!;
  const priv = privateKey.export({ format: "jwk" }).d!;
  return {
    publicKey: Buffer.from(pub, "base64url").toString("hex"),
    privateKey: Buffer.from(priv, "base64url").toString("hex"),
  };
}
