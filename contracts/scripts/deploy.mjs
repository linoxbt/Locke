/**
 * Deploy LockeVaultFactory (its vault implementation comes with it) to Base or a Base fork.
 *
 *   RPC_URL=https://mainnet.base.org DEPLOYER_PRIVATE_KEY=0x… ADMIN=0x… GUARDIAN=0x… KEEPER=0x… \
 *   MAX_VAULT_USD=1000 MAX_TOTAL_USD=25000 node scripts/deploy.mjs
 *
 * ADMIN and GUARDIAN must be contracts (Locke's multisig): the script refuses plain wallets unless
 * ALLOW_EOA_ROLES=1 (tests and forks only), and refuses a keeper equal to either or to the deployer.
 * The caps have no defaults. Before deploying it checks Veranta's router and storage point at each
 * other; afterwards it reads every setting back. Prints the factory address for
 * BASE_FACTORY_ADDRESS. Run `npx hardhat compile` first, and verify the source on BaseScan after.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`${k} is not set`);
  return v;
};
const addr = (k) => {
  const v = env(k);
  if (!isAddress(v)) throw new Error(`${k} must be an address`);
  return v;
};

const rpc = env("RPC_URL", "https://mainnet.base.org");
const account = privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY"));
const chain = { ...base, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
if ((await pub.getChainId()) !== 8453) throw new Error("RPC_URL is not Base (chain 8453)");

const artifact = JSON.parse(fs.readFileSync(new URL("../artifacts/src/LockeVaultFactory.sol/LockeVaultFactory.json", import.meta.url), "utf8"));
const usd = (k) => {
  const n = Number(env(k));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be a positive number of USD`);
  return BigInt(Math.round(n * 1e6));
};
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = "0x44914408af82bC9983bbb330e3578E1105e11d4e";
const STORAGE = "0x8a311D7048c35985aa31C131B9A13e03a5f7422d";
const lower = (a) => a.toLowerCase();

// Roles: the admin and guardian hold Locke's power over every vault, so they must be multisigs.
const [admin, guardian, keeper] = [addr("ADMIN"), addr("GUARDIAN"), addr("KEEPER")];
for (const [name, a] of [["ADMIN", admin], ["GUARDIAN", guardian]]) {
  const code = await pub.getCode({ address: a });
  if ((!code || code === "0x") && process.env.ALLOW_EOA_ROLES !== "1") throw new Error(`${name} ${a} is not a contract: use a multisig (or ALLOW_EOA_ROLES=1 on a fork)`);
}
if ([lower(admin), lower(guardian), lower(account.address)].includes(lower(keeper))) throw new Error("KEEPER must be its own key, not the admin, guardian or deployer");

// Veranta's router and storage must be the pair the vaults will trade through.
const veranta = [
  "function storageT() view returns (address)",
  "function trading() view returns (address)",
].map((f) => ({ type: "function", name: f.match(/function (\w+)/)[1], inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }));
const [routerStorage, storageTrading] = await Promise.all([
  pub.readContract({ address: ROUTER, abi: veranta, functionName: "storageT" }),
  pub.readContract({ address: STORAGE, abi: veranta, functionName: "trading" }),
]);
if (lower(routerStorage) !== lower(STORAGE) || lower(storageTrading) !== lower(ROUTER)) throw new Error("Veranta's router and storage don't point at each other: addresses changed?");

const args = [
  admin,
  guardian,
  keeper,
  USDC, // USDC on Base
  ROUTER, // Veranta TradingRouter
  STORAGE, // Veranta TradingStorage
  usd("MAX_VAULT_USD"),
  usd("MAX_TOTAL_USD"),
];
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${hash}`);

// Read every setting back from the deployed factory.
const factory = receipt.contractAddress;
const read = (functionName) => pub.readContract({ address: factory, abi: artifact.abi, functionName });
const onChain = { admin: await read("admin"), guardian: await read("guardian"), keeper: await read("keeper"), usdc: await read("usdc"), router: await read("router"), tradingStorage: await read("tradingStorage"), maxVaultDeposits: await read("maxVaultDeposits"), maxTotalDeposits: await read("maxTotalDeposits"), feeBps: await read("feeBps") };
const expected = { admin, guardian, keeper, usdc: USDC, router: ROUTER, tradingStorage: STORAGE, maxVaultDeposits: args[6], maxTotalDeposits: args[7], feeBps: 0 };
for (const [k, v] of Object.entries(expected)) {
  const got = onChain[k];
  if (typeof v === "string" ? lower(got) !== lower(v) : BigInt(got) !== BigInt(v)) throw new Error(`factory ${k} reads ${got}, expected ${v}`);
}
console.log(JSON.stringify({ factory: receipt.contractAddress, tx: hash, admin: args[0], guardian: args[1], keeper: args[2], maxVaultUsd: Number(args[6]) / 1e6, maxTotalUsd: Number(args[7]) / 1e6 }, null, 2));
