// Server configuration. Read lazily so `next build` works without secrets.

/** A required setting is missing or malformed. Routes answer 503 with the variable's name (never its value). */
export class ConfigError extends Error {
  constructor(public variable: string, detail = "is not set") {
    super(`Locke isn't fully configured: ${variable} ${detail}.`);
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(name);
  return v;
}

export const config = {
  get strikeApiUrl() {
    return (process.env.STRIKE_API_URL ?? "https://api.strikefinance.org").replace(/\/+$/, "");
  },
  /** Streams default to the same host as STRIKE_API_URL, so pointing it at testnet moves them too. */
  get strikeUserWsUrl() {
    return process.env.STRIKE_WS_USER_URL ?? `${this.strikeApiUrl.replace(/^http/, "ws")}/ws/user-api`;
  },
  get strikePriceWsUrl() {
    return process.env.STRIKE_WS_PRICE_URL ?? `${this.strikeApiUrl.replace(/^http/, "ws")}/ws/price`;
  },
  get builderCode() {
    return required("STRIKE_BUILDER_CODE");
  },
  /** Per-order builder fee. A server constant, never taken from the browser. Required: a silent 0 would stick to every user who connects. */
  get builderFeeBps() {
    const raw = process.env.STRIKE_BUILDER_FEE_BPS;
    if (raw == null || raw.trim() === "") throw new ConfigError("STRIKE_BUILDER_FEE_BPS");
    const n = Number(raw);
    const max = this.builderMaxBps;
    if (!Number.isInteger(n) || n < 0 || n > max) throw new ConfigError("STRIKE_BUILDER_FEE_BPS", `must be a whole number from 0 to ${max} (the builder code's maximum)`);
    return n;
  },
  /** The maximum fee registered for the builder code on Strike (LockeIn: 20 bps). */
  get builderMaxBps() {
    const n = Number(process.env.STRIKE_BUILDER_MAX_BPS ?? "20");
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new ConfigError("STRIKE_BUILDER_MAX_BPS", "must be 0..100");
    return n;
  },
  get networkId() {
    return Number(process.env.NEXT_PUBLIC_CARDANO_NETWORK_ID ?? "1");
  },
  get koiosUrl() {
    return (process.env.KOIOS_URL ?? "https://api.koios.rest/api/v1").replace(/\/+$/, "");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get keyEnc() {
    const hex = required("LOCKE_KEY_ENC");
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new ConfigError("LOCKE_KEY_ENC", "must be 32 bytes of hex");
    return Buffer.from(hex, "hex");
  },
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new ConfigError("SESSION_SECRET", "must be at least 32 characters");
    return s;
  },
  get demoAlerts() {
    return process.env.LOCKE_DEMO_ALERTS === "true";
  },
};
