/**
 * Week-1 live check on Veranta's test network (a Base mainnet fork run by Veranta, with its own
 * operators filling orders). Deploys the factory, creates a vault with an ETH holdings plan, and
 * times how long Veranta takes to fill orders the vault sends directly.
 *
 *   node scripts/testnet-run.mjs <keys.json> [results.json]
 *
 * keys.json holds throwaway test-network keys {owner, keeper, guardian}; it is created if missing.
 * Test funds only: the faucet below is the test network's own impersonation method.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC = "https://devnet-rpc.veranta.xyz";
const FEED = "https://feed-v3-testnet.veranta.xyz";
const CORE = "https://staging-api.veranta.xyz/core";
const ROUTER = "0x44914408af82bC9983bbb330e3578E1105e11d4e";
const STORAGE = "0x8a311D7048c35985aa31C131B9A13e03a5f7422d";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH_WHALE = "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A"; // from Veranta's own SDK faucet
const USDC_WHALE = "0x6c561B446416E1A00E8E93E221854d6eA4171372";
const ETH = 0n;
const P10 = 10n ** 10n;
const USD = (n) => BigInt(Math.round(n * 1e6));

const [keysPath, outPath] = process.argv.slice(2);
if (!keysPath) throw new Error("usage: node scripts/testnet-run.mjs <keys.json> [results.json]");
if (!fs.existsSync(keysPath)) {
  fs.writeFileSync(keysPath, JSON.stringify({ owner: generatePrivateKey(), keeper: generatePrivateKey(), guardian: generatePrivateKey() }, null, 2), { mode: 0o600 });
}
const keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
const chain = { ...base, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (pk) => createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(RPC) });
const owner = wallet(keys.owner), keeper = wallet(keys.keeper), guardian = wallet(keys.guardian);

const artifact = (name) => JSON.parse(fs.readFileSync(new URL(`../artifacts/src/${name}.sol/${name}.json`, import.meta.url), "utf8"));
const Factory = artifact("LockeVaultFactory"), Vault = artifact("LockeVault");
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const storageAbi = parseAbi([
  "struct Trade { address trader; uint256 pairIndex; uint256 index; uint256 initialPosToken; uint256 positionSizeUSDC; uint256 openPrice; bool buy; uint256 leverage; uint256 tp; uint256 sl; uint256 timestamp; }",
  "function openTrades(address, uint256, uint256) view returns (Trade)",
  "function openTradesCount(address, uint256) view returns (uint256)",
  "function pendingMarketOpenCount(address, uint256) view returns (uint256)",
  "function pendingMarketCloseCount(address, uint256) view returns (uint256)",
]);

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
const faucet = async (from, to, data = "0x", value = 0n) => {
  const hash = await rpc("dev_impersonateTransaction", [{ from, to, data, value: `0x${value.toString(16)}` }]);
  await pub.waitForTransactionReceipt({ hash });
};
const price = async (pair) => {
  const j = await (await fetch(`${FEED}/v2/pairs/${pair}/price-update-data`)).json();
  if (!j.pro) throw new Error(`no test-network price for pair ${pair}`);
  return { data: j.pro.priceUpdateData, price: BigInt(Math.round(j.pro.price * 1e10)) };
};
const send = async (w, args) => {
  const hash = await w.writeContract(args);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${args.functionName} reverted: ${hash}`);
  return r;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { network: RPC, startedAt: new Date().toISOString(), steps: [] };
const log = (step, data = {}) => {
  results.steps.push({ step, at: new Date().toISOString(), ...data });
  console.log(step, JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

/** Wait until `done()` is true, polling every second; returns seconds taken or null on timeout. */
async function waitFor(done, timeoutS = 300) {
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < timeoutS) {
    if (await done()) return (Date.now() - t0) / 1000;
    await sleep(1000);
  }
  return null;
}

// 1. Test funds: the SDK's dev faucet when the node offers it, otherwise funds sent by hand
// (Veranta hands out test funds on its Discord).
try {
  for (const w of [owner, keeper, guardian]) await faucet(ETH_WHALE, w.account.address, "0x", parseEther("0.05"));
  const transferData = (await import("viem")).encodeFunctionData({ abi: erc20, functionName: "transfer", args: [owner.account.address, USD(1000)] });
  await faucet(USDC_WHALE, USDC, transferData);
} catch (e) {
  console.log(`faucet unavailable (${e.message}); using existing balances`);
}
const ownerUsdc = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [owner.account.address] });
const gas = await Promise.all([owner, keeper, guardian].map((w) => pub.getBalance({ address: w.account.address })));
if (ownerUsdc < USD(300) || gas.some((g) => g < parseEther("0.001"))) {
  console.log("Needs test funds: 300 USDC + 0.001 ETH on owner, 0.001 ETH on keeper and guardian:");
  for (const w of [owner, keeper, guardian]) console.log(" ", w.account.address);
  process.exit(2);
}
log("funded", { owner: owner.account.address, usdc: ownerUsdc });

// 2. Factory and vault: ETH holdings plan, short up to 3x and $300 of notional, funded with $300
const deployHash = await owner.deployContract({
  abi: Factory.abi,
  bytecode: Factory.bytecode,
  // admin, guardian, keeper, USDC, Veranta, launch caps ($1,000 a vault, $10,000 in total)
  args: [owner.account.address, guardian.account.address, keeper.account.address, USDC, ROUTER, STORAGE, USD(1000), USD(10_000)],
});
const factory = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress;
await send(owner, { address: USDC, abi: erc20, functionName: "approve", args: [factory, USD(300)] });
const created = await send(owner, {
  address: factory, abi: Factory.abi, functionName: "createVault",
  args: [ETH, { enabled: true, buy: false, maxLeverage: 3n * P10, maxNotional: USD(300) }, USD(300)],
});
const vault = parseEventLogs({ abi: Factory.abi, logs: created.logs, eventName: "VaultCreated" })[0].args.vault;
log("vault created", { factory, vault });

const count = (fn) => pub.readContract({ address: STORAGE, abi: storageAbi, functionName: fn, args: [vault, ETH] });
const trade = async () => {
  for (let i = 0n; i < 40n; i++) {
    const t = await pub.readContract({ address: STORAGE, abi: storageAbi, functionName: "openTrades", args: [vault, ETH, i] });
    if (t.leverage > 0n) return { ...t, index: i };
  }
  return null;
};
const vaultUsdc = () => pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [vault] });

// 3. Keeper opens the hedge: $60 at 2x = $120 short. Veranta's operators must fill it.
const p1 = await price(ETH);
await send(keeper, { address: vault, abi: Vault.abi, functionName: "hedgeOpen", args: [ETH, USD(60), 2n * P10, p1.price, P10] });
log("open sent", { price: Number(p1.price) / 1e10 });
const openFill = await waitFor(async () => (await count("openTradesCount")) === 1n);
const t1 = await trade();
log("open filled", { seconds: openFill, collateral: t1 && Number(t1.initialPosToken) / 1e6, openPrice: t1 && Number(t1.openPrice) / 1e10, buy: t1?.buy });
if (!t1) {
  log("not filled", { pendingOpen: await count("pendingMarketOpenCount") });
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(results, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  process.exit(1);
}

// 4. Keeper tops up $10 of margin; this one fills in the same transaction.
const p2 = await price(ETH);
const tTop = Date.now();
await send(keeper, { address: vault, abi: Vault.abi, functionName: "topUpMargin", args: [ETH, t1.index, USD(10), [p2.data], 1], value: 1n });
const t2 = await trade();
log("top-up filled", { seconds: (Date.now() - tTop) / 1000, collateral: Number(t2.initialPosToken) / 1e6 });

// 5. Hold briefly, then read Veranta's own view of the position (funding sign).
await sleep(90_000);
try {
  const ud = await (await fetch(`${CORE}/user-data?trader=${vault}`)).json();
  log("position per Veranta API", { raw: JSON.stringify(ud).slice(0, 1500) });
} catch (e) {
  log("position API unavailable", { error: String(e) });
}

// 6. Keeper closes; proceeds return to the vault.
const before = await vaultUsdc();
await send(keeper, { address: vault, abi: Vault.abi, functionName: "hedgeClose", args: [ETH, t2.index, t2.initialPosToken, (await price(ETH)).price] });
const closeFill = await waitFor(async () => (await count("openTradesCount")) === 0n);
const after = await vaultUsdc();
log("close filled", { seconds: closeFill, vaultUsdcBefore: Number(before) / 1e6, vaultUsdcAfter: Number(after) / 1e6 });

// 7. Owner withdraws everything.
await send(owner, { address: vault, abi: Vault.abi, functionName: "withdraw", args: [owner.account.address, after] });
log("withdrawn", { vaultUsdc: Number(await vaultUsdc()) / 1e6 });

results.finishedAt = new Date().toISOString();
if (outPath) fs.writeFileSync(outPath, JSON.stringify(results, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
