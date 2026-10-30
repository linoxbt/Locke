/**
 * "Protect as you get paid" against the real Base Account stack on a Base mainnet fork: a Coinbase
 * Smart Wallet (what a Base Account is) owns a vault and signs a spend permission naming the vault
 * as spender, exactly as the wallet does for requestSpendPermission. The keeper then moves USDC
 * from the wallet into the vault through the real SpendPermissionManager, within the allowance.
 * Run with: FORK=1 npx hardhat test test/fork.income.test.ts
 */
import hre from "hardhat";
import { expect } from "chai";
import { encodeAbiParameters, parseAbi, parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { asSlotValue, expectRevert, P10, PAIR, USD, usdcBalanceSlot, VERANTA } from "./helpers";

const MANAGER: Address = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";
const WALLET_FACTORY: Address = "0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a";
// Hardhat's first dev key: the human signer behind the smart wallet.
const SIGNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

const walletFactoryAbi = parseAbi([
  "function createAccount(bytes[] owners, uint256 nonce) payable returns (address)",
  "function getAddress(bytes[] owners, uint256 nonce) view returns (address)",
]);
const walletAbi = parseAbi(["function replaySafeHash(bytes32 hash) view returns (bytes32)", "function isOwnerAddress(address) view returns (bool)"]);
const managerAbi = parseAbi([
  "struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }",
  "function getHash(SpendPermission spendPermission) view returns (bytes32)",
  "function isApproved(SpendPermission spendPermission) view returns (bool)",
  "function revoke(SpendPermission spendPermission)",
]);
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address, uint256) returns (bool)"]);
// The manager's custom errors by selector (Hardhat can't name errors of a contract it didn't compile).
const EXCEEDED = "0xfd1ebc88"; // ExceededSpendPermission(uint256,uint256)
const UNAUTHORIZED = "0x282b9f97"; // UnauthorizedSpendPermission()

describe("Protect as you get paid (Base fork, real SpendPermissionManager)", function () {
  before(function () {
    if (!process.env.FORK) this.skip();
  });

  it("a Base Account signs once; the keeper moves its USDC into its vault within the allowance", async function () {
    const pub = await hre.viem.getPublicClient();
    const test = await hre.viem.getTestClient();
    const [admin, keeper, guardian] = await hre.viem.getWalletClients();

    // A smart wallet owned by our signer, with the SpendPermissionManager as an owner too: that is
    // how a Base Account lets spend permissions move its funds.
    const owners = [SIGNER.address, MANAGER].map((a) => encodeAbiParameters([{ type: "address" }], [a]));
    await pub.waitForTransactionReceipt({ hash: await admin.writeContract({ address: WALLET_FACTORY, abi: walletFactoryAbi, functionName: "createAccount", args: [owners, 7n] }) });
    const account = await pub.readContract({ address: WALLET_FACTORY, abi: walletFactoryAbi, functionName: "getAddress", args: [owners, 7n] });
    expect(await pub.readContract({ address: account, abi: walletAbi, functionName: "isOwnerAddress", args: [MANAGER] })).to.equal(true);
    await test.setStorageAt({ address: VERANTA.usdc, index: usdcBalanceSlot(account), value: asSlotValue(USD(1000)) });

    // The business (the smart wallet) creates its vault.
    const factory = await hre.viem.deployContract("LockeVaultFactory", [admin.account.address, guardian.account.address, keeper.account.address, VERANTA.usdc, VERANTA.router, VERANTA.storage, USD(5000), USD(50_000)]);
    await test.impersonateAccount({ address: account });
    await test.setBalance({ address: account, value: parseEther("1") });
    const biz = await hre.viem.getWalletClient(account);
    await biz.writeContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "approve", args: [factory.address, USD(300)] });
    const created = await pub.waitForTransactionReceipt({
      hash: await biz.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVault", args: [PAIR.ETH, { enabled: true, buy: false, maxLeverage: 2n * P10, maxNotional: USD(200) }, USD(300)] }),
    });
    const [ev] = parseEventLogs({ abi: factory.abi, logs: created.logs, eventName: "VaultCreated" });
    const vault = await hre.viem.getContractAt("LockeVault", ev.args.vault);
    await test.stopImpersonatingAccount({ address: account });

    // The wallet signs a spend permission: up to $50 a week, to the vault. A Coinbase Smart Wallet
    // signs the manager's EIP-712 hash, made replay-safe for the wallet, wrapped with the owner index.
    const now = Number((await pub.getBlock()).timestamp);
    const permission = { account, spender: vault.address, token: VERANTA.usdc, allowance: USD(50), period: 7 * 86400, start: now - 60, end: now + 365 * 86400, salt: 42n, extraData: "0x" as Hex };
    const digest = await pub.readContract({ address: MANAGER, abi: managerAbi, functionName: "getHash", args: [permission] });
    const safe = await pub.readContract({ address: account, abi: walletAbi, functionName: "replaySafeHash", args: [digest] });
    const raw = await SIGNER.sign({ hash: safe });
    const signature = encodeAbiParameters([{ type: "tuple", components: [{ name: "ownerIndex", type: "uint256" }, { name: "signatureData", type: "bytes" }] }], [{ ownerIndex: 0n, signatureData: raw }]);

    const usdcOf = (a: Address) => pub.readContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] });
    const refused = (amount: bigint) => vault.write.collectIncome([permission, "0x", amount], { account: keeper.account });
    const walletBefore = await usdcOf(account);
    const vaultBefore = await usdcOf(vault.address);

    // First collection carries the signature and approves the permission on chain.
    await pub.waitForTransactionReceipt({ hash: await vault.write.collectIncome([permission, signature, USD(30)], { account: keeper.account }) });
    expect(await pub.readContract({ address: MANAGER, abi: managerAbi, functionName: "isApproved", args: [permission] })).to.equal(true);
    await pub.waitForTransactionReceipt({ hash: await vault.write.collectIncome([permission, "0x", USD(20)], { account: keeper.account }) });
    expect(await usdcOf(vault.address)).to.equal(vaultBefore + USD(50));
    expect(await usdcOf(account)).to.equal(walletBefore - USD(50));
    expect(await usdcOf(keeper.account.address)).to.equal(0n);

    // The week's allowance is used up.
    await expectRevert(refused(USD(1)), EXCEEDED);

    // Next week it resets.
    await test.increaseTime({ seconds: 7 * 86400 });
    await test.mine({ blocks: 1 });
    await pub.waitForTransactionReceipt({ hash: await vault.write.collectIncome([permission, "0x", USD(10)], { account: keeper.account }) });
    expect(await usdcOf(vault.address)).to.equal(vaultBefore + USD(60));

    // The owner revokes it from their wallet; nothing more can be collected.
    await test.impersonateAccount({ address: account });
    await biz.writeContract({ address: MANAGER, abi: managerAbi, functionName: "revoke", args: [permission] });
    await test.stopImpersonatingAccount({ address: account });
    await expectRevert(refused(USD(1)), UNAUTHORIZED);
    console.log(`      smart wallet ${account} → vault ${vault.address}: collected $60 over two weeks, then revoked`);
  });
});
