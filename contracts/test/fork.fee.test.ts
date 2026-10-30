/**
 * Locke's fee against the real Veranta on a Base mainnet fork: an open whose price moves past its
 * slippage is never filled (Veranta's operator reverts HighSlippage, then cancels it), and the fee
 * owed for it is cancelled, not kept; a filled open pays it. The vault leaves Veranta no standing
 * USDC allowance. Run with: FORK=1 npx hardhat test test/fork.fee.test.ts
 */
import hre from "hardhat";
import { expect } from "chai";
import { parseAbi, parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { VERANTA, PAIR, SOURCING, P10, USD, priceUpdate, usdcBalanceSlot, asSlotValue, NO_SPREAD } from "./helpers";

const routerAbi = parseAbi([
  "function updateOperator(address operator, bool isOperator)",
  "struct Spread { int256 spreadP; uint256 bookDepth; int256 impactParam; bool byPass; int256 maxSpreadP; bool slot_1; int256 slot_3; }",
  "function executeMarketOrder(uint256 orderId, bytes[] priceUpdateData, uint8 priceSourcing, Spread spreadParams) payable",
  "function cancelPendingMarketOrder(uint256 orderId)",
]);
const storageAbi = parseAbi(["function gov() view returns (address)"]);
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address, uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);

describe("Locke's fee on Veranta (Base fork)", function () {
  before(function () {
    if (!process.env.FORK) this.skip();
  });

  it("cancels the fee for an open Veranta never fills, and pays it for one it does", async function () {
    const pub = await hre.viem.getPublicClient();
    const test = await hre.viem.getTestClient();
    const [owner, keeper, guardian, operator, collector] = await hre.viem.getWalletClients();
    const gov = (await pub.readContract({ address: VERANTA.storage, abi: storageAbi, functionName: "gov" })) as Address;
    await test.impersonateAccount({ address: gov });
    await test.setBalance({ address: gov, value: parseEther("1") });
    await (await hre.viem.getWalletClient(gov)).writeContract({ address: VERANTA.router, abi: routerAbi, functionName: "updateOperator", args: [operator.account.address, true] });
    await test.setStorageAt({ address: VERANTA.usdc, index: usdcBalanceSlot(owner.account.address), value: asSlotValue(USD(1000)) });

    const factory = await hre.viem.deployContract("LockeVaultFactory", [owner.account.address, guardian.account.address, keeper.account.address, VERANTA.usdc, VERANTA.router, VERANTA.storage, USD(1000), USD(10_000)]);
    await factory.write.setFee([20, collector.account.address], { account: owner.account });
    await owner.writeContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "approve", args: [factory.address, USD(800)] });
    const newVault = async () => {
      const created = await pub.waitForTransactionReceipt({
        hash: await factory.write.createVault([PAIR.ETH, { enabled: true, buy: true, maxLeverage: 5n * P10, maxNotional: USD(200) }, USD(400)], { account: owner.account }),
      });
      return hre.viem.getContractAt("LockeVault", parseEventLogs({ abi: factory.abi, logs: created.logs, eventName: "VaultCreated" })[0].args.vault);
    };
    // Two vaults, so the filled open needn't wait out the first one's cooldown (moving the fork's
    // clock would make Veranta's live signed prices look stale).
    const vault = await newVault();
    const vault2 = await newVault();
    const usdcOf = (a: Address) => pub.readContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
    const allowance = (v = vault) => pub.readContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "allowance", args: [v.address, VERANTA.storage] }) as Promise<bigint>;
    const orderOf = async (hash: Hex) =>
      parseEventLogs({ abi: vault.abi, logs: (await pub.waitForTransactionReceipt({ hash })).logs, eventName: "HedgeOpenRequested" })[0].args.orderId;
    const execute = async (orderId: bigint) => {
      const px = await priceUpdate(PAIR.ETH);
      return operator.writeContract({ address: VERANTA.router, abi: routerAbi, functionName: "executeMarketOrder", args: [orderId, [px.data], SOURCING.PYTH_LAZER, NO_SPREAD], value: 1n });
    };
    expect(await allowance()).to.equal(0n);

    // A long whose wanted price is far below the market (1% slippage): Veranta won't fill it.
    const px = await priceUpdate(PAIR.ETH);
    const stuck = await orderOf(await vault.write.hedgeOpen([PAIR.ETH, USD(40), 5n * P10, px.price / 2n, P10], { account: keeper.account }));
    expect(await vault.read.feeOwed([PAIR.ETH])).to.equal(USD(0.4)); // 0.20% of $200
    expect(await usdcOf(collector.account.address)).to.equal(0n);
    expect(await allowance()).to.equal(0n); // Veranta took exactly the collateral
    let refused = false;
    try {
      await execute(stuck);
    } catch {
      refused = true; // HighSlippage
    }
    expect(refused, "Veranta filled an order outside its slippage").to.equal(true);
    await vault.write.settleFee([PAIR.ETH]); // still pending: nothing moves
    expect(await vault.read.feeOwed([PAIR.ETH])).to.equal(USD(0.4));
    await operator.writeContract({ address: VERANTA.router, abi: routerAbi, functionName: "cancelPendingMarketOrder", args: [stuck] });
    await vault.write.settleFee([PAIR.ETH]);
    expect(await vault.read.feeOwed([PAIR.ETH])).to.equal(0n);
    expect(await usdcOf(collector.account.address)).to.equal(0n);
    expect(await usdcOf(vault.address)).to.equal(USD(400));

    // An open at the market fills, and its fee is paid.
    const now = await priceUpdate(PAIR.ETH);
    const filled = await orderOf(await vault2.write.hedgeOpen([PAIR.ETH, USD(40), 5n * P10, now.price, P10], { account: keeper.account }));
    await execute(filled);
    await vault2.write.settleFee([PAIR.ETH]);
    expect(await usdcOf(collector.account.address)).to.equal(USD(0.4));
    expect(await vault2.read.feeOwed([PAIR.ETH])).to.equal(0n);
    expect(await allowance(vault2)).to.equal(0n);
  });
});
