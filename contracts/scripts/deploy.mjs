/**
 * Deploy LockeVaultFactory (its vault implementation comes with it) to Base or a Base fork.
 *
 *   RPC_URL=https://mainnet.base.org DEPLOYER_PRIVATE_KEY=0x… ADMIN=0x… GUARDIAN=0x… KEEPER=0x… \
 *   MAX_VAULT_USD=1000 MAX_TOTAL_USD=25000 node scripts/deploy.mjs
 *
 * ADMIN and GUARDIAN should be Locke's multisig; KEEPER is the Base keeper's address. Prints the
 * factory address for BASE_FACTORY_ADDRESS. Run `npx hardhat compile` first.
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
const usd = (k, d) => BigInt(Math.round(Number(env(k, d)) * 1e6));
const args = [
  addr("ADMIN"),
  addr("GUARDIAN"),
  addr("KEEPER"),
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
  "0x44914408af82bC9983bbb330e3578E1105e11d4e", // Veranta TradingRouter
  "0x8a311D7048c35985aa31C131B9A13e03a5f7422d", // Veranta TradingStorage
  usd("MAX_VAULT_USD", "1000"),
  usd("MAX_TOTAL_USD", "25000"),
];
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${hash}`);
console.log(JSON.stringify({ factory: receipt.contractAddress, tx: hash, admin: args[0], guardian: args[1], keeper: args[2], maxVaultUsd: Number(args[6]) / 1e6, maxTotalUsd: Number(args[7]) / 1e6 }, null, 2));
