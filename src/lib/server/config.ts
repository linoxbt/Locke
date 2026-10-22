// Server configuration. Read lazily so `next build` works without secrets.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const config = {
  get strikeApiUrl() {
    return (process.env.STRIKE_API_URL ?? "https://api.strikefinance.org").replace(/\/+$/, "");
  },
  get strikeUserWsUrl() {
    return process.env.STRIKE_WS_USER_URL ?? "wss://api.strikefinance.org/ws/user-api";
  },
  get strikePriceWsUrl() {
    return process.env.STRIKE_WS_PRICE_URL ?? "wss://api.strikefinance.org/ws/price";
  },
  get builderCode() {
    return required("STRIKE_BUILDER_CODE");
  },
  /** Per-order builder fee. A server constant, never taken from the browser. */
  get builderFeeBps() {
    const n = Math.floor(Number(process.env.STRIKE_BUILDER_FEE_BPS ?? "0"));
    if (!isFinite(n) || n < 0 || n > 100) throw new Error("STRIKE_BUILDER_FEE_BPS must be 0..100");
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
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("LOCKE_KEY_ENC must be 32 bytes of hex");
    return Buffer.from(hex, "hex");
  },
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    return s;
  },
  get demoAlerts() {
    return process.env.LOCKE_DEMO_ALERTS === "true";
  },
};
