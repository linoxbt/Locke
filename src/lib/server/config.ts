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
  /** Veranta on Base: data and core APIs behind one gateway, and its signed price feed. */
  get verantaApiUrl() {
    return (process.env.VERANTA_API_URL ?? "https://prod-api.veranta.xyz").replace(/\/+$/, "");
  },
  get verantaFeedUrl() {
    return (process.env.VERANTA_FEED_URL ?? "https://feed-v3.veranta.xyz").replace(/\/+$/, "");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new ConfigError("SESSION_SECRET", "must be at least 32 characters");
    return s;
  },
  /**
   * Locke on Base runs on Base mainnet (chain 8453), where Veranta is. Point this at Veranta's test
   * network (a Base fork, also chain 8453) to try it with test funds.
   */
  get baseRpcUrl() {
    return process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  },
  /** The deployed LockeVaultFactory. Unset: Locke on Base shows as not live yet. */
  get baseFactoryAddress(): `0x${string}` | null {
    const a = process.env.BASE_FACTORY_ADDRESS;
    if (!a) return null;
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new ConfigError("BASE_FACTORY_ADDRESS", "must be an address");
    return a as `0x${string}`;
  },
  /** Locke's Builder Code from the Base dashboard (bc_…); appended to every Base transaction when set. */
  get baseBuilderCode(): string | null {
    const c = process.env.BASE_BUILDER_CODE;
    if (!c) return null;
    if (!/^[A-Za-z0-9_]{1,32}$/.test(c)) throw new ConfigError("BASE_BUILDER_CODE", "must be a Builder Code like bc_abc123");
    return c;
  },
  /** The Base keeper's private key (worker only). It can trade vaults within their plans, never withdraw. */
  get baseKeeperKey(): `0x${string}` {
    const k = required("BASE_KEEPER_PRIVATE_KEY");
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new ConfigError("BASE_KEEPER_PRIVATE_KEY", "must be 32 bytes of hex with 0x");
    return k as `0x${string}`;
  },
  /** Where agents' x402 payments for the agent API go (USDC on Base). Unset: the agent API answers 503. */
  get x402PayTo(): `0x${string}` | null {
    const a = process.env.X402_PAY_TO;
    if (!a) return null;
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new ConfigError("X402_PAY_TO", "must be an address");
    return a as `0x${string}`;
  },
  /** A hosted x402 facilitator to verify and settle payments. Unset: Locke settles them itself with X402_SETTLER_PRIVATE_KEY. */
  get x402FacilitatorUrl(): string | null {
    return process.env.X402_FACILITATOR_URL || null;
  },
  /** The gas wallet that settles agents' payments on Base when Locke is its own facilitator. Holds a little ETH, never USDC. */
  get x402SettlerKey(): `0x${string}` | null {
    const k = process.env.X402_SETTLER_PRIVATE_KEY;
    if (!k) return null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new ConfigError("X402_SETTLER_PRIVATE_KEY", "must be 32 bytes of hex with 0x");
    return k as `0x${string}`;
  },
};
