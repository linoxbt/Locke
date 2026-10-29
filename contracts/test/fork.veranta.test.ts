/**
 * The vault against the real Veranta contracts on a Base mainnet fork. Orders are filled the way
 * Veranta's operators fill them: a signed Pyth Lazer price from Veranta's feed, posted by an
 * operator. Run with: FORK=1 npx hardhat test test/fork.veranta.test.ts
 */
import hre from "hardhat";
import { expect } from "chai";
import { parseAbi, parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { VERANTA, PAIR, SOURCING, P10, USD, priceUpdate, usdcBalanceSlot, asSlotValue, NO_SPREAD, expectRevert } from "./helpers";

const routerAbi = parseAbi([
  "function updateOperator(address operator, bool isOperator)",
  "function isOperator(address) view returns (bool)",
  "struct Spread { int256 spreadP; uint256 bookDepth; int256 impactParam; bool byPass; int256 maxSpreadP; bool slot_1; int256 slot_3; }",
  "function executeMarketOrder(uint256 orderId, bytes[] priceUpdateData, uint8 priceSourcing, Spread spreadParams) payable",
]);
const storageAbi = parseAbi([
  "struct Trade { address trader; uint256 pairIndex; uint256 index; uint256 initialPosToken; uint256 positionSizeUSDC; uint256 openPrice; bool buy; uint256 leverage; uint256 tp; uint256 sl; uint256 timestamp; }",
  "function openTrades(address, uint256, uint256) view returns (Trade)",
  "function openTradesCount(address, uint256) view returns (uint256)",
  "function gov() view returns (address)",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const LAZER_FEE = 1n; // PythLazer.verification_fee on Base (1 wei); excess would be refunded to the aggregator

describe("LockeVault on Veranta (Base fork)", function () {
  before(function () {
    if (!process.env.FORK) this.skip();
  });

  async function setup() {
    const pub = await hre.viem.getPublicClient();
    const test = await hre.viem.getTestClient();
    const [owner, keeper, guardian, operator, stranger] = await hre.viem.getWalletClients();

    // Make our operator a Veranta operator, as its governance would.
    const gov = (await pub.readContract({ address: VERANTA.storage, abi: storageAbi, functionName: "gov" })) as Address;
    await test.impersonateAccount({ address: gov });
    await test.setBalance({ address: gov, value: parseEther("1") });
    const govWallet = await hre.viem.getWalletClient(gov);
    await govWallet.writeContract({ address: VERANTA.router, abi: routerAbi, functionName: "updateOperator", args: [operator.account.address, true] });

    // Give the business owner 1,000 USDC.
    await test.setStorageAt({ address: VERANTA.usdc, index: usdcBalanceSlot(owner.account.address), value: asSlotValue(USD(1000)) });

    const factory = await hre.viem.deployContract("LockeVaultFactory", [
      owner.account.address, // admin
      guardian.account.address,
      keeper.account.address,
      VERANTA.usdc,
      VERANTA.router,
      VERANTA.storage,
      USD(1000), // launch cap per vault
      USD(10_000), // launch cap across vaults
    ]);
    await owner.writeContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "approve", args: [factory.address, USD(500)] });
    // Costs plan: long WTI, up to 5x and $200 of notional, funded with $400.
    const hash = await factory.write.createVault([PAIR.WTI, { enabled: true, buy: true, maxLeverage: 5n * P10, maxNotional: USD(200) }, USD(400)], {
      account: owner.account,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    const [created] = parseEventLogs({ abi: factory.abi, logs: receipt.logs, eventName: "VaultCreated" });
    const vault = await hre.viem.getContractAt("LockeVault", created.args.vault);

    const usdcOf = (a: Address) => pub.readContract({ address: VERANTA.usdc, abi: usdcAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
    const tradeAt = (pair: bigint) => async () => {
      for (let i = 0n; i < 40n; i++) {
        const t = (await pub.readContract({ address: VERANTA.storage, abi: storageAbi, functionName: "openTrades", args: [vault.address, pair, i] })) as {
          leverage: bigint; initialPosToken: bigint; buy: boolean; openPrice: bigint; index: bigint;
        };
        if (t.leverage > 0n) return { ...t, index: i };
      }
      return null;
    };
    const openCount = (pair: bigint) =>
      pub.readContract({ address: VERANTA.storage, abi: storageAbi, functionName: "openTradesCount", args: [vault.address, pair] }) as Promise<bigint>;

    /** Fill a pending vault order the way Veranta's operators do. */
    async function fill(hash: Hex, pair: bigint) {
      const r = await pub.waitForTransactionReceipt({ hash });
      const logs = parseEventLogs({ abi: vault.abi, logs: r.logs });
      const ev = logs.find((l) => l.eventName === "HedgeOpenRequested" || l.eventName === "HedgeCloseRequested");
      if (!ev) throw new Error("no order event");
      const orderId = (ev.args as { orderId: bigint }).orderId;
      const px = await priceUpdate(pair);
      await operator.writeContract({
        address: VERANTA.router,
        abi: routerAbi,
        functionName: "executeMarketOrder",
        args: [orderId, [px.data], SOURCING.PYTH_LAZER, NO_SPREAD],
        value: LAZER_FEE,
      });
      return orderId;
    }

    return { pub, owner, keeper, guardian, operator, stranger, factory, vault, usdcOf, tradeAt, openCount, fill };
  }

  it("runs a WTI costs plan and an ETH holdings plan end to end", async function () {
    const { owner, keeper, guardian, stranger, vault, usdcOf, tradeAt, openCount, fill } = await setup();

    expect((await vault.read.owner()).toLowerCase()).to.equal(owner.account.address.toLowerCase());
    expect(await usdcOf(vault.address)).to.equal(USD(400));

    // --- Open: keeper hedges WTI long, $20 at 2x = $40 notional.
    const wti = await priceUpdate(PAIR.WTI);
    console.log(`      WTI ${Number(wti.price) / 1e10}`);
    const openHash = await vault.write.hedgeOpen([PAIR.WTI, USD(20), 2n * P10, wti.price, P10], { account: keeper.account });
    await fill(openHash, PAIR.WTI);
    const t1 = await tradeAt(PAIR.WTI)();
    expect(t1, "WTI trade stored for the vault").to.not.equal(null);
    expect(t1!.buy).to.equal(true);
    expect(t1!.leverage).to.equal(2n * P10);
    console.log(`      WTI hedge open: collateral ${Number(t1!.initialPosToken) / 1e6} USDC at ${Number(t1!.openPrice) / 1e10}`);

    // --- Plan limits hold on chain.
    await expectRevert(vault.write.hedgeOpen([PAIR.WTI, USD(20), 2n * P10, wti.price, P10], { account: keeper.account }), "TooSoon");
    await expectRevert(vault.write.hedgeOpen([PAIR.ETH, USD(50), 2n * P10, wti.price, P10], { account: keeper.account }), "PlanDisabled");
    await expectRevert(vault.write.hedgeOpen([PAIR.WTI, USD(20), 2n * P10, wti.price, P10], { account: stranger.account }), "NotKeeper");

    // --- Top up: keeper adds $5 of margin, filled in the same transaction.
    const before = t1!.initialPosToken;
    const top = await priceUpdate(PAIR.WTI);
    await vault.write.topUpMargin([PAIR.WTI, t1!.index, USD(5), [top.data], SOURCING.PYTH_LAZER], { account: keeper.account, value: LAZER_FEE });
    const t2 = await tradeAt(PAIR.WTI)();
    expect(t2!.initialPosToken > before, "margin went up").to.equal(true);
    console.log(`      WTI top-up: collateral ${Number(before) / 1e6} -> ${Number(t2!.initialPosToken) / 1e6} USDC`);

    // --- Holdings plan on the same vault: owner allows an ETH short, up to 3x and $150.
    await vault.write.setPlan([PAIR.ETH, true, false, 3n * P10, USD(150)], { account: owner.account });
    const eth = await priceUpdate(PAIR.ETH);
    await expectRevert(vault.write.hedgeOpen([PAIR.ETH, USD(50), 4n * P10, eth.price, P10], { account: keeper.account }), "LeverageTooHigh");
    await expectRevert(vault.write.hedgeOpen([PAIR.ETH, USD(80), 2n * P10, eth.price, P10], { account: keeper.account }), "NotionalTooHigh");
    const ethHash = await vault.write.hedgeOpen([PAIR.ETH, USD(50), 2n * P10, eth.price, P10], { account: keeper.account });
    await fill(ethHash, PAIR.ETH);
    const e1 = await tradeAt(PAIR.ETH)();
    expect(e1!.buy).to.equal(false);
    console.log(`      ETH short open: collateral ${Number(e1!.initialPosToken) / 1e6} USDC at ${Number(e1!.openPrice) / 1e10}`);

    // --- Guardian pause stops new hedges and deposits, never exits.
    await vault.write.setPaused([true], { account: guardian.account });
    await expectRevert(vault.write.hedgeOpen([PAIR.WTI, USD(20), 2n * P10, wti.price, P10], { account: keeper.account }), "IsPaused");
    await expectRevert(vault.write.deposit([USD(1)], { account: owner.account }), "IsPaused");

    // --- Keeper closes WTI; the proceeds land in the vault.
    const idle1 = await usdcOf(vault.address);
    const closeHash = await vault.write.hedgeClose([PAIR.WTI, t2!.index, t2!.initialPosToken, (await priceUpdate(PAIR.WTI)).price], { account: keeper.account });
    await fill(closeHash, PAIR.WTI);
    const idle2 = await usdcOf(vault.address);
    expect(await openCount(PAIR.WTI)).to.equal(0n);
    expect(idle2 > idle1, "close proceeds paid to the vault").to.equal(true);
    console.log(`      WTI closed: vault idle ${Number(idle1) / 1e6} -> ${Number(idle2) / 1e6} USDC`);

    // --- Owner removes the keeper and exits the ETH hedge alone, while paused.
    await vault.write.setKeeper(["0x0000000000000000000000000000000000000000"], { account: owner.account });
    await expectRevert(vault.write.hedgeClose([PAIR.ETH, e1!.index, e1!.initialPosToken, 0n], { account: keeper.account }), "NotKeeper");
    const ownerClose = await vault.write.ownerClose([PAIR.ETH, e1!.index, e1!.initialPosToken, (await priceUpdate(PAIR.ETH)).price], { account: owner.account });
    await fill(ownerClose, PAIR.ETH);
    expect(await openCount(PAIR.ETH)).to.equal(0n);

    // --- Owner withdraws everything.
    const idle3 = await usdcOf(vault.address);
    const ownerBefore = await usdcOf(owner.account.address);
    await vault.write.withdraw([owner.account.address, idle3], { account: owner.account });
    expect(await usdcOf(vault.address)).to.equal(0n);
    expect((await usdcOf(owner.account.address)) - ownerBefore).to.equal(idle3);
    console.log(`      Owner withdrew ${Number(idle3) / 1e6} USDC of 400 deposited (fees and price moves on two round trips)`);
  });
});
