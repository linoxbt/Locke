/** Offline unit tests for the vault and factory, against a mock Veranta. */
import hre from "hardhat";
import { expect } from "chai";
import { parseEventLogs, zeroAddress } from "viem";
import { P10, USD, expectRevert } from "./helpers";
import { deployFixture, WTI, ETH, HOUR, PX } from "./fixture";

const lower = (a: string) => a.toLowerCase();

describe("LockeVault (unit)", () => {
  describe("creation", () => {
    it("belongs to the wallet that created it, funded and with its first plan", async () => {
      const { owner, keeper, guardian, factory, vault, usdcOf } = await deployFixture();
      expect(lower(await vault.read.owner())).to.equal(lower(owner.account.address));
      expect(lower(await vault.read.keeper())).to.equal(lower(keeper.account.address));
      expect(await vault.read.keeperFollowsFactory()).to.equal(true);
      expect(lower(await vault.read.guardian())).to.equal(lower(guardian.account.address));
      expect(lower(await vault.read.factory())).to.equal(lower(factory.address));
      expect(await usdcOf(vault.address)).to.equal(USD(300));
      expect(await vault.read.netDeposits()).to.equal(USD(300));
      expect(await factory.read.totalDeposits()).to.equal(USD(300));
      expect(await vault.read.plans([WTI])).to.deep.equal([true, true, 3n * P10, USD(100), USD(100)]);
    });

    it("cannot be initialized twice, nor its implementation at all", async () => {
      const { owner, factory, vault, usdc, veranta } = await deployFixture();
      const plan = { enabled: true, buy: true, maxLeverage: P10, maxNotional: 1n, maxCollateral: 1n };
      const args = [owner.account.address, 0, WTI, plan, usdc.address, veranta.address, veranta.address] as const;
      await expectRevert(vault.write.initialize([...args]), "InvalidInitialization");
      const impl = await hre.viem.getContractAt("LockeVault", await factory.read.implementation());
      await expectRevert(impl.write.initialize([...args]), "InvalidInitialization");
    });

    it("refuses a plan that is enabled but empty", async () => {
      const { createVault, owner2 } = await deployFixture();
      await expectRevert(createVault(owner2, 0n, { enabled: true, buy: true, maxLeverage: P10 / 2n, maxNotional: USD(10), maxCollateral: USD(10) }), "BadPlan");
      await expectRevert(createVault(owner2, 0n, { enabled: true, buy: true, maxLeverage: P10, maxNotional: 0n, maxCollateral: USD(10) }), "BadPlan");
      await expectRevert(createVault(owner2, 0n, { enabled: true, buy: true, maxLeverage: P10, maxNotional: USD(10), maxCollateral: 0n }), "BadPlan");
      // A disabled plan may be empty.
      await createVault(owner2, 0n, { enabled: false, buy: true, maxLeverage: 0n, maxNotional: 0n, maxCollateral: 0n });
    });

    it("refuses an enabled plan without a collateral cap through setPlan too", async () => {
      const { owner, vault } = await deployFixture();
      await expectRevert(vault.write.setPlan([ETH, true, false, 2n * P10, USD(50), 0n], { account: owner.account }), "BadPlan");
      await vault.write.setPlan([ETH, true, false, 2n * P10, USD(50), USD(20)], { account: owner.account });
      expect(await vault.read.plans([ETH])).to.deep.equal([true, false, 2n * P10, USD(50), USD(20)]);
      await vault.write.setPlan([ETH, false, false, 0n, 0n, 0n], { account: owner.account });
      expect(await vault.read.plans([ETH])).to.deep.equal([false, false, 0n, 0n, 0n]);
    });
  });

  describe("keeper", () => {
    it("keeps slippage on and at most 3%, and leverage at least 1x", async () => {
      const { keeper, vault } = await deployFixture();
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, 0n], { account: keeper.account }), "SlippageOutOfRange");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, 3n * P10 + 1n], { account: keeper.account }), "SlippageOutOfRange");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), P10 - 1n, PX, P10], { account: keeper.account }), "LeverageTooLow");
      await vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, 3n * P10], { account: keeper.account });
    });

    it("refuses an open with no wanted price", async () => {
      const { keeper, vault } = await deployFixture();
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, 0n, P10], { account: keeper.account }), "ZeroPrice");
      await vault.write.hedgeOpen([WTI, USD(10), 2n * P10, 1n, P10], { account: keeper.account });
    });

    it("leaves Veranta no standing allowance on the vault's USDC", async () => {
      const { keeper, vault, veranta, usdc } = await deployFixture();
      expect(await usdc.read.allowance([vault.address, veranta.address])).to.equal(0n);
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      expect(await usdc.read.allowance([vault.address, veranta.address])).to.equal(0n);
      await vault.write.topUpMargin([WTI, 0n, USD(10), [], 1], { account: keeper.account });
      expect(await usdc.read.allowance([vault.address, veranta.address])).to.equal(0n);
    });

    it("stops a revoked keeper key in every vault at once; only the admin restores it", async () => {
      const { keeper, guardian, admin, stranger, factory, vault, owner, usdcOf } = await deployFixture();
      await expectRevert(factory.write.setKeeperRevoked([keeper.account.address, true], { account: stranger.account }), "NotGuardian");
      await factory.write.setKeeperRevoked([keeper.account.address, true], { account: guardian.account });
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper.account }), "NotKeeper");
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(1), [], 1], { account: keeper.account }), "NotKeeper");
      // The owner's exits don't depend on it.
      await vault.write.withdraw([owner.account.address, USD(10)], { account: owner.account });
      expect(await usdcOf(vault.address)).to.equal(USD(290));
      await expectRevert(factory.write.setKeeperRevoked([keeper.account.address, false], { account: guardian.account }), "NotAdmin");
      await factory.write.setKeeperRevoked([keeper.account.address, false], { account: admin.account });
      await vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper.account });
    });

    it("hedges only within the plan", async () => {
      const { keeper, stranger, veranta, vault } = await deployFixture();
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: stranger.account }), "NotKeeper");
      await expectRevert(vault.write.hedgeOpen([ETH, USD(10), 2n * P10, PX, P10], { account: keeper.account }), "PlanDisabled");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 4n * P10, PX, P10], { account: keeper.account }), "LeverageTooHigh");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(51), 2n * P10, PX, P10], { account: keeper.account }), "NotionalTooHigh");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(101), 1n * P10, PX, P10], { account: keeper.account }), "CollateralTooHigh");
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account }); // exactly $100
      expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 1n * P10, PX, P10], { account: keeper.account }), "TooSoon");
    });

    it("caps the collateral of an open at the plan's collateral cap, apart from its notional cap", async () => {
      const { keeper, owner2, veranta, createVault } = await deployFixture();
      // Up to $100 of notional but only $30 of collateral in the position.
      const v = await createVault(owner2, USD(300), { enabled: true, buy: true, maxLeverage: 4n * P10, maxNotional: USD(100), maxCollateral: USD(30) });
      await expectRevert(v.write.hedgeOpen([WTI, USD(31), 2n * P10, PX, P10], { account: keeper.account }), "CollateralTooHigh"); // $62 notional: within it
      await v.write.hedgeOpen([WTI, USD(30), 3n * P10, PX, P10], { account: keeper.account });
      expect(await veranta.read.collateralOf([v.address, WTI])).to.equal(USD(30));
      // Top-ups count against the same cap.
      await expectRevert(v.write.topUpMargin([WTI, 0n, 1n, [], 1], { account: keeper.account }), "CollateralTooHigh");
    });

    it("opens a market at most once an hour, and one position at a time", async () => {
      const { owner, keeper, vault, later } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      await later(3000);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), P10, PX, P10], { account: keeper.account }), "TooSoon");
      await later(600);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), P10, PX, P10], { account: keeper.account }), "PositionExists");
      await vault.write.ownerClose([WTI, 0n, USD(50), 0n], { account: owner.account });
      await vault.write.hedgeOpen([WTI, USD(10), P10, PX, P10], { account: keeper.account });
    });

    it("keeps the keeper away from the money", async () => {
      const { owner, keeper, vault, usdc } = await deployFixture();
      const k = { account: keeper.account };
      await expectRevert(vault.write.withdraw([keeper.account.address, USD(1)], k), "NotOwner");
      await expectRevert(vault.write.setPlan([WTI, true, true, 50n * P10, USD(1e6), USD(1e6)], k), "NotOwner");
      await expectRevert(vault.write.setKeeper([keeper.account.address], k), "NotOwner");
      await expectRevert(vault.write.followFactoryKeeper(k), "NotOwner");
      await expectRevert(vault.write.transferOwnership([keeper.account.address], k), "NotOwner");
      await expectRevert(vault.write.sweepEth([keeper.account.address], k), "NotOwner");
      await expectRevert(vault.write.rescueToken([usdc.address, keeper.account.address, 1n], k), "NotOwner");
      await expectRevert(vault.write.ownerUpdateMargin([WTI, 0n, 1, USD(1), [], 1], k), "NotOwner");
      await expectRevert(vault.write.ownerClose([WTI, 0n, USD(1), 0n], k), "NotOwner");
      expect(lower(await vault.read.owner())).to.equal(lower(owner.account.address));
    });

    it("tops up margin only up to the plan's collateral cap", async () => {
      const { keeper, veranta, vault, later } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      await vault.write.topUpMargin([WTI, 0n, USD(10), ["0x01"], 1], { account: keeper.account, value: 7n });
      expect(await veranta.read.lastValue()).to.equal(7n);
      expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
      await later(120);
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(50) + 1n, [], 1], { account: keeper.account }), "CollateralTooHigh");
      await vault.write.topUpMargin([WTI, 0n, USD(50), [], 1], { account: keeper.account }); // collateral $100 = maxCollateral
      await later(120);
      await expectRevert(vault.write.topUpMargin([WTI, 0n, 1n, [], 1], { account: keeper.account }), "CollateralTooHigh");
      await expectRevert(vault.write.topUpMargin([WTI, 0n, 0n, [], 1], { account: keeper.account }), "ZeroAmount");
    });

    it("tops up a market at most once every two minutes", async () => {
      const { keeper, veranta, vault, pub, later } = await deployFixture();
      expect(await vault.read.TOP_UP_COOLDOWN()).to.equal(120n);
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      expect(await vault.read.lastTopUpAt([WTI])).to.equal(0n);
      const hash = await vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account });
      const { blockNumber } = await pub.waitForTransactionReceipt({ hash });
      expect(await vault.read.lastTopUpAt([WTI])).to.equal((await pub.getBlock({ blockNumber })).timestamp);
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account }), "TooSoon");
      await later(60);
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account }), "TooSoon");
      await later(60);
      await vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account });
      expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
      // A refused top-up (over the cap) doesn't start the cooldown.
      await later(120);
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(51), [], 1], { account: keeper.account }), "CollateralTooHigh");
      await vault.write.topUpMargin([WTI, 0n, USD(1), [], 1], { account: keeper.account });
    });

    it("tracks the top-up cooldown per market", async () => {
      const { owner, keeper, veranta, vault } = await deployFixture();
      await vault.write.setPlan([ETH, true, false, 2n * P10, USD(100), USD(60)], { account: owner.account });
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      await vault.write.hedgeOpen([ETH, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      await vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account });
      await vault.write.topUpMargin([ETH, 0n, USD(5), [], 1], { account: keeper.account });
      expect(await veranta.read.collateralOf([vault.address, ETH])).to.equal(USD(45));
      await expectRevert(vault.write.topUpMargin([ETH, 0n, USD(5), [], 1], { account: keeper.account }), "TooSoon");
    });

    it("has no way to close a hedge; the owner's close sends the proceeds back to the vault", async () => {
      const { owner, keeper, vault, usdcOf } = await deployFixture();
      expect(vault.abi.some((x) => x.type === "function" && x.name === ("hedgeClose" as string))).to.equal(false);
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      expect(await usdcOf(vault.address)).to.equal(USD(260));
      await expectRevert(vault.write.ownerClose([WTI, 0n, USD(40), 0n], { account: keeper.account }), "NotOwner");
      await vault.write.ownerClose([WTI, 0n, USD(40), 0n], { account: owner.account });
      expect(await usdcOf(vault.address)).to.equal(USD(300));
    });
  });

  describe("keeper key", () => {
    it("follows the factory's keeper: rotating it there moves every following vault", async () => {
      const { admin, keeper, keeper2, factory, vault, createVault, owner2 } = await deployFixture();
      const v2 = await createVault(owner2);
      await factory.write.setKeeper([keeper2.account.address], { account: admin.account });
      for (const v of [vault, v2]) {
        expect(lower(await v.read.keeper())).to.equal(lower(keeper2.account.address));
        await expectRevert(v.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper.account }), "NotKeeper");
        await v.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper2.account });
      }
      // Vaults created after the rotation get the new key too.
      const v3 = await createVault(owner2);
      expect(lower(await v3.read.keeper())).to.equal(lower(keeper2.account.address));
    });

    it("leaves a vault whose owner picked its own keeper alone, until it follows the factory again", async () => {
      const { admin, owner, keeper, keeper2, stranger, factory, vault } = await deployFixture();
      await vault.write.setKeeper([stranger.account.address], { account: owner.account });
      expect(await vault.read.keeperFollowsFactory()).to.equal(false);
      expect(lower(await vault.read.keeper())).to.equal(lower(stranger.account.address));
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper.account }), "NotKeeper");
      await factory.write.setKeeper([keeper2.account.address], { account: admin.account });
      expect(lower(await vault.read.keeper())).to.equal(lower(stranger.account.address));
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper2.account }), "NotKeeper");
      await vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: stranger.account });
      // Back to Locke's keeper, whatever it is now.
      await vault.write.followFactoryKeeper({ account: owner.account });
      expect(await vault.read.keeperFollowsFactory()).to.equal(true);
      expect(lower(await vault.read.keeper())).to.equal(lower(keeper2.account.address));
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(1), [], 1], { account: stranger.account }), "NotKeeper");
      await vault.write.topUpMargin([WTI, 0n, USD(1), [], 1], { account: keeper2.account });
    });

    it("has no keeper at all when the owner removes it, even if the factory has one", async () => {
      const { owner, keeper, vault, factory } = await deployFixture();
      await vault.write.setKeeper([zeroAddress], { account: owner.account });
      expect(await vault.read.keeper()).to.equal(zeroAddress);
      expect(lower(await factory.read.keeper())).to.equal(lower(keeper.account.address));
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper.account }), "NotKeeper");
    });

    it("refuses every caller when the factory has no keeper", async () => {
      const { admin, keeper, factory, vault } = await deployFixture();
      await factory.write.setKeeper([zeroAddress], { account: admin.account });
      expect(await vault.read.keeper()).to.equal(zeroAddress);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper.account }), "NotKeeper");
    });

    it("still refuses a revoked key the owner picked as its own", async () => {
      const { owner, guardian, keeper2, factory, vault } = await deployFixture();
      await vault.write.setKeeper([keeper2.account.address], { account: owner.account });
      await factory.write.setKeeperRevoked([keeper2.account.address, true], { account: guardian.account });
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, PX, P10], { account: keeper2.account }), "NotKeeper");
    });
  });

  describe("fee", () => {
    it("owes the fee when an open is placed and pays it to Locke's collector once the trade exists", async () => {
      const { keeper, collector, vault, usdcOf, stranger } = await deployFixture({ feeBps: 10 });
      expect(await vault.read.feeBps()).to.equal(10);
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account }); // $100 notional
      expect(await vault.read.feeOwed([WTI])).to.equal(USD(0.1)); // 0.10%
      expect(await usdcOf(collector.account.address)).to.equal(0n);
      await vault.write.settleFee([WTI], { account: stranger.account }); // anyone may settle
      expect(await usdcOf(collector.account.address)).to.equal(USD(0.1));
      expect(await vault.read.feeOwed([WTI])).to.equal(0n);
      expect(await usdcOf(vault.address)).to.equal(USD(300 - 50 - 0.1));
    });

    it("never keeps a fee for an open that didn't fill", async () => {
      const { keeper, collector, vault, veranta, usdcOf, later } = await deployFixture({ feeBps: 10 });
      await veranta.write.setHoldOpens([true]);
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      await vault.write.settleFee([WTI]); // still pending: nothing moves
      expect(await vault.read.feeOwed([WTI])).to.equal(USD(0.1));
      await veranta.write.cancelPending([vault.address, WTI]); // the operator cancels it
      await vault.write.settleFee([WTI]);
      expect(await vault.read.feeOwed([WTI])).to.equal(0n);
      expect(await usdcOf(collector.account.address)).to.equal(0n);
      expect(await usdcOf(vault.address)).to.equal(USD(300));
      // The next open clears anything left owed by a cancelled one before owing its own.
      await later();
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      expect(await vault.read.feeOwed([WTI])).to.equal(USD(0.1));
    });

    it("charges a market at most once in 30 days, however often the hedge is reopened", async () => {
      const { keeper, owner, collector, vault, usdcOf, later } = await deployFixture({ feeBps: 10 });
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      await vault.write.settleFee([WTI]);
      await vault.write.ownerClose([WTI, 0n, USD(50), 0n], { account: owner.account });
      await later();
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      expect(await vault.read.feeOwed([WTI])).to.equal(0n);
      expect(await usdcOf(collector.account.address)).to.equal(USD(0.1));
      await vault.write.ownerClose([WTI, 0n, USD(50), 0n], { account: owner.account });
      await later(30 * 24 * HOUR);
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      expect(await vault.read.feeOwed([WTI])).to.equal(USD(0.1));
    });

    it("never lets a failed fee payment block the owner's close", async () => {
      const { keeper, owner, vault, usdcOf } = await deployFixture({ feeBps: 10 });
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      // The owner empties the idle balance first: the fee can't be paid in full, and the close still works.
      await vault.write.withdraw([owner.account.address, await usdcOf(vault.address)], { account: owner.account });
      await vault.write.ownerClose([WTI, 0n, USD(50), 0n], { account: owner.account });
      expect(await usdcOf(vault.address)).to.equal(USD(50));
    });

    it("keeps an existing vault's fee when Locke changes it, and caps it at 0.20%", async () => {
      const { admin, collector, factory, createVault, owner2 } = await deployFixture({ feeBps: 10 });
      await expectRevert(factory.write.setFee([21, collector.account.address], { account: admin.account }), "FeeTooHigh");
      await expectRevert(factory.write.setFee([5, zeroAddress], { account: admin.account }), "ZeroAddress");
      await factory.write.setFee([20, collector.account.address], { account: admin.account });
      const v2 = await createVault(owner2);
      expect(await v2.read.feeBps()).to.equal(20);
    });

    it("charges nothing by default", async () => {
      const { keeper, vault, usdcOf, collector } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, PX, P10], { account: keeper.account });
      expect(await usdcOf(collector.account.address)).to.equal(0n);
    });
  });

  describe("owner", () => {
    it("can withdraw an ownership handover that wasn't accepted", async () => {
      const { owner, owner2, vault } = await deployFixture();
      await vault.write.transferOwnership([owner2.account.address], { account: owner.account });
      await vault.write.cancelOwnershipTransfer({ account: owner.account });
      await expectRevert(vault.write.acceptOwnership({ account: owner2.account }), "NotPendingOwner");
    });

    it("removes the keeper and exits alone", async () => {
      const { owner, keeper, veranta, vault, usdcOf } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      await vault.write.setKeeper([zeroAddress], { account: owner.account });
      await expectRevert(vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account }), "NotKeeper");
      await vault.write.ownerUpdateMargin([WTI, 0n, 1, USD(5), [], 1], { account: owner.account });
      await vault.write.ownerClose([WTI, 0n, USD(35), 0n], { account: owner.account });
      expect(await veranta.read.openCount([vault.address, WTI])).to.equal(0n);
      const before = await usdcOf(owner.account.address);
      await vault.write.withdraw([owner.account.address, USD(300)], { account: owner.account });
      expect((await usdcOf(owner.account.address)) - before).to.equal(USD(300));
    });

    it("hands the vault over in two steps", async () => {
      const { owner, stranger, owner2, vault } = await deployFixture();
      await expectRevert(vault.write.transferOwnership([zeroAddress], { account: owner.account }), "ZeroAddress");
      await vault.write.transferOwnership([owner2.account.address], { account: owner.account });
      await expectRevert(vault.write.acceptOwnership({ account: stranger.account }), "NotPendingOwner");
      await vault.write.withdraw([owner.account.address, 1n], { account: owner.account }); // still the owner until accepted
      await vault.write.acceptOwnership({ account: owner2.account });
      await expectRevert(vault.write.withdraw([owner.account.address, 1n], { account: owner.account }), "NotOwner");
      await vault.write.withdraw([owner2.account.address, 1n], { account: owner2.account });
    });

    it("rescues other tokens but never USDC that way", async () => {
      const { owner, vault, usdc } = await deployFixture();
      const other = await hre.viem.deployContract("MockUSDC");
      await other.write.mint([vault.address, 5n]);
      await vault.write.rescueToken([other.address, owner.account.address, 5n], { account: owner.account });
      expect(await other.read.balanceOf([owner.account.address])).to.equal(5n);
      await expectRevert(vault.write.rescueToken([usdc.address, owner.account.address, 1n], { account: owner.account }), "UseWithdraw");
    });
  });

  describe("guardian and pause", () => {
    it("pauses new hedges and others' deposits, never exits or the owner's deposits", async () => {
      const { owner, keeper, guardian, stranger, vault, usdc, usdcOf } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account });
      await expectRevert(vault.write.setPaused([true], { account: stranger.account }), "NotGuardian");
      await vault.write.setPaused([true], { account: guardian.account });
      await usdc.write.approve([vault.address, USD(1)], { account: stranger.account });
      await expectRevert(vault.write.deposit([USD(1)], { account: stranger.account }), "IsPaused");
      // The owner may still add, to keep the hedge's buffer up.
      await usdc.write.approve([vault.address, USD(1)], { account: owner.account });
      await vault.write.deposit([USD(1)], { account: owner.account });
      expect(await vault.read.netDeposits()).to.equal(USD(301));
      await vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account });
      await vault.write.ownerClose([WTI, 0n, USD(45), 0n], { account: owner.account });
      await expectRevert(vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account }), "IsPaused");
      const before = await usdcOf(owner.account.address);
      await vault.write.withdraw([owner.account.address, USD(301)], { account: owner.account });
      expect((await usdcOf(owner.account.address)) - before).to.equal(USD(301));
    });

    it("lets the owner deposit while paused only within the launch caps", async () => {
      const { owner, guardian, factory, vault, usdc } = await deployFixture({ maxVault: USD(350) });
      await factory.write.setPaused([true], { account: guardian.account });
      await usdc.write.approve([vault.address, USD(100)], { account: owner.account });
      await expectRevert(vault.write.deposit([USD(51)], { account: owner.account }), "VaultCapReached");
      await vault.write.deposit([USD(50)], { account: owner.account });
      expect(await factory.read.totalDeposits()).to.equal(USD(350));
    });

    it("pauses every vault from the factory, and follows a new guardian", async () => {
      const { admin, owner, keeper, guardian, stranger, factory, vault, createVault, owner2 } = await deployFixture();
      await factory.write.setPaused([true], { account: guardian.account });
      expect(await vault.read.paused()).to.equal(true);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(40), 2n * P10, PX, P10], { account: keeper.account }), "IsPaused");
      await expectRevert(createVault(owner2), "IsPaused");
      await vault.write.withdraw([owner.account.address, USD(1)], { account: owner.account });
      await factory.write.setPaused([false], { account: guardian.account });
      await expectRevert(factory.write.setGuardian([stranger.account.address], { account: guardian.account }), "NotAdmin");
      await factory.write.setGuardian([stranger.account.address], { account: admin.account });
      await expectRevert(vault.write.setPaused([true], { account: guardian.account }), "NotGuardian");
      await vault.write.setPaused([true], { account: stranger.account });
    });
  });

  describe("launch caps", () => {
    it("caps deposits per vault and in total, and frees room on withdrawal", async () => {
      const { owner, owner2, factory, admin, vault, usdc, createVault } = await deployFixture({ maxVault: USD(500), maxTotal: USD(700) });
      await usdc.write.approve([vault.address, USD(1000)], { account: owner.account });
      await expectRevert(vault.write.deposit([USD(201)], { account: owner.account }), "VaultCapReached");
      await vault.write.deposit([USD(200)], { account: owner.account }); // vault at 500
      await expectRevert(createVault(owner2, USD(201)), "TotalCapReached");
      const v2 = await createVault(owner2, USD(200)); // total at 700
      await vault.write.withdraw([owner.account.address, USD(100)], { account: owner.account });
      expect(await factory.read.totalDeposits()).to.equal(USD(600));
      await usdc.write.approve([v2.address, USD(100)], { account: owner2.account });
      await v2.write.deposit([USD(100)], { account: owner2.account });
      await factory.write.setCaps([USD(1000), USD(2000)], { account: admin.account });
      await vault.write.deposit([USD(500)], { account: owner.account });
    });

    it("never lets accounting block a withdrawal, even of profits above deposits", async () => {
      const { owner, vault, usdc, factory, usdcOf } = await deployFixture();
      await usdc.write.mint([vault.address, USD(50)]); // a winning hedge paid out more than was deposited
      await vault.write.withdraw([owner.account.address, USD(350)], { account: owner.account });
      expect(await usdcOf(vault.address)).to.equal(0n);
      expect(await vault.read.netDeposits()).to.equal(0n);
      expect(await factory.read.totalDeposits()).to.equal(0n);
    });

    it("only lets vaults touch the accounting", async () => {
      const { stranger, factory } = await deployFixture();
      await expectRevert(factory.write.recordDeposit([1n, 1n], { account: stranger.account }), "NotVault");
      await expectRevert(factory.write.recordWithdraw([1n], { account: stranger.account }), "NotVault");
    });
  });

  describe("factory", () => {
    it("sets the fee and collector in its constructor, and refuses a bad pair", async () => {
      const { admin, guardian, keeper, collector, usdc, veranta } = await deployFixture();
      const args = (fee: number, to: `0x${string}`) =>
        [admin.account.address, guardian.account.address, keeper.account.address, usdc.address, veranta.address, veranta.address, USD(1000), USD(10_000), fee, to] as const;
      const f = await hre.viem.deployContract("LockeVaultFactory", [...args(15, collector.account.address)]);
      expect(await f.read.feeBps()).to.equal(15);
      expect(lower(await f.read.feeCollector())).to.equal(lower(collector.account.address));
      await expectRevert(hre.viem.deployContract("LockeVaultFactory", [...args(21, collector.account.address)]), "FeeTooHigh");
      await expectRevert(hre.viem.deployContract("LockeVaultFactory", [...args(5, zeroAddress)]), "ZeroAddress");
      const free = await hre.viem.deployContract("LockeVaultFactory", [...args(0, zeroAddress)]);
      expect(await free.read.feeBps()).to.equal(0);
      expect(await free.read.feeCollector()).to.equal(zeroAddress);
      const max = await hre.viem.deployContract("LockeVaultFactory", [...args(20, collector.account.address)]);
      expect(await max.read.feeBps()).to.equal(20);
    });

    it("gives vaults created with a constructor fee that fee", async () => {
      const { vault, factory, collector } = await deployFixture({ feeBps: 7 });
      expect(await factory.read.feeBps()).to.equal(7);
      expect(lower(await factory.read.feeCollector())).to.equal(lower(collector.account.address));
      expect(await vault.read.feeBps()).to.equal(7);
    });

    it("records each vault's creation block", async () => {
      const { pub, factory, vault, createVault, owner2, stranger } = await deployFixture();
      const first = await factory.read.createdAtBlock([vault.address]);
      expect(first > 0n).to.equal(true);
      const v2 = await createVault(owner2);
      expect(await factory.read.createdAtBlock([v2.address])).to.equal(await pub.getBlockNumber());
      expect((await factory.read.createdAtBlock([v2.address])) > first).to.equal(true);
      expect(await factory.read.createdAtBlock([stranger.account.address])).to.equal(0n);
    });

    it("lists the vaults each address created, oldest first", async () => {
      const { owner, owner2, stranger, factory, vault, createVault } = await deployFixture();
      const v2 = await createVault(owner2);
      const v3 = await createVault(owner);
      expect((await factory.read.vaultsOf([owner.account.address])).map(lower)).to.deep.equal([vault.address, v3.address].map(lower));
      expect((await factory.read.vaultsOf([owner2.account.address])).map(lower)).to.deep.equal([lower(v2.address)]);
      expect(await factory.read.vaultsOf([stranger.account.address])).to.deep.equal([]);
      expect(await factory.read.vaultCount()).to.equal(3n);
    });
  });

  describe("admin", () => {
    it("can cancel an admin handover that wasn't accepted", async () => {
      const { pub, admin, stranger, factory } = await deployFixture();
      await expectRevert(factory.write.cancelAdminTransfer({ account: stranger.account }), "NotAdmin");
      await factory.write.transferAdmin([stranger.account.address], { account: admin.account });
      expect(lower(await factory.read.pendingAdmin())).to.equal(lower(stranger.account.address));
      const hash = await factory.write.cancelAdminTransfer({ account: admin.account });
      const logs = parseEventLogs({ abi: factory.abi, logs: (await pub.waitForTransactionReceipt({ hash })).logs, eventName: "AdminTransferCancelled" });
      expect(logs.length).to.equal(1);
      expect(lower(logs[0].args.pendingAdmin)).to.equal(lower(stranger.account.address));
      expect(await factory.read.pendingAdmin()).to.equal(zeroAddress);
      await expectRevert(factory.write.acceptAdmin({ account: stranger.account }), "NotPendingAdmin");
      expect(lower(await factory.read.admin())).to.equal(lower(admin.account.address));
    });

    it("hands admin over in two steps and guards every setting", async () => {
      const { admin, stranger, keeper, factory } = await deployFixture();
      const s = { account: stranger.account };
      await expectRevert(factory.write.setKeeper([stranger.account.address], s), "NotAdmin");
      await expectRevert(factory.write.setCaps([1n, 1n], s), "NotAdmin");
      await expectRevert(factory.write.setFee([1, stranger.account.address], s), "NotAdmin");
      await expectRevert(factory.write.transferAdmin([stranger.account.address], s), "NotAdmin");
      await factory.write.transferAdmin([stranger.account.address], { account: admin.account });
      await expectRevert(factory.write.acceptAdmin({ account: keeper.account }), "NotPendingAdmin");
      await factory.write.acceptAdmin(s);
      expect(lower(await factory.read.admin())).to.equal(lower(stranger.account.address));
      await expectRevert(factory.write.setCaps([1n, 1n], { account: admin.account }), "NotAdmin");
    });
  });
});
