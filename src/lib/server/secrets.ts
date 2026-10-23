import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import { config } from "./config";

const TAG_BYTES = 16;

/**
 * AES-256-GCM. Format: v2.<iv>.<tag>.<ciphertext>, base64url, authenticated together with `aad`
 * (the API wallet's public key), so a ciphertext copied onto another row won't decrypt.
 * v1 (no AAD) is still read for rows written before v2.
 */
export function encryptSecret(plain: string, aad: string, key: Buffer = config.keyEnc): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string, aad: string, key: Buffer = config.keyEnc): string {
  const [v, iv, tag, ct] = blob.split(".");
  if ((v !== "v1" && v !== "v2") || !iv || !tag || !ct) throw new Error("Unsupported secret format");
  const tagBuf = Buffer.from(tag, "base64url");
  if (tagBuf.length !== TAG_BYTES) throw new Error("Bad authentication tag");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
  if (v === "v2") decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tagBuf);
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
