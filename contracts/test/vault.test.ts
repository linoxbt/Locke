/** Offline unit tests for the vault and factory, against a mock Veranta. */
import hre from "hardhat";
import { expect } from "chai";
import { zeroAddress } from "viem";
import { P10, USD, expectRevert } from "./helpers";
import { deployFixture, WTI, ETH } from "./fixture";

const lower = (a: string) => a.toLowerCase();

describe("LockeVault (unit)", () => {
  describe("creation", () => {
    it("belongs to the wallet that created it, funded and with its first plan", async () => {
      const { owner, keeper, guardian, factory, vault, usdcOf } = await deployFixture();
      expect(lower(await vault.read.owner())).to.equal(lower(owner.account.address));
      expect(lower(await vault.read.keeper())).to.equal(lower(keeper.account.address));
      expect(lower(await vault.read.guardian())).to.equal(lower(guardian.account.address));
      expect(lower(await vault.read.factory())).to.equal(lower(factory.address));
      expect(await usdcOf(vault.address)).to.equal(USD(300));
      expect(await vault.read.netDeposits()).to.equal(USD(300));
      expect(await factory.read.totalDeposits()).to.equal(USD(300));
      expect(await vault.read.plans([WTI])).to.deep.equal([true, true, 3n * P10, USD(100)]);
    });

    it("cannot be initialized twice, nor its implementation at all", async () => {
      const { owner, factory, vault, usdc, veranta } = await deployFixture();
      const plan = { enabled: true, buy: true, maxLeverage: P10, maxNotional: 1n };
      const args = [owner.account.address, owner.account.address, 0, WTI, plan, usdc.address, veranta.address, veranta.address] as const;
      await expectRevert(vault.write.initialize(args), "InvalidInitialization");
      const impl = await hre.viem.getContractAt("LockeVault", await factory.read.implementation());
      await expectRevert(impl.write.initialize(args), "InvalidInitialization");
    });

    it("refuses a plan that is enabled but empty", async () => {
      const { createVault, owner2 } = await deployFixture();
      await expectRevert(createVault(owner2, 0n, { enabled: true, buy: true, maxLeverage: P10 / 2n, maxNotional: USD(10) }), "BadPlan");
      await expectRevert(createVault(owner2, 0n, { enabled: true, buy: true, maxLeverage: P10, maxNotional: 0n }), "BadPlan");
    });
  });

  describe("keeper", () => {
    it("hedges only within the plan", async () => {
      const { keeper, stranger, veranta, vault } = await deployFixture();
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, 0n, P10], { account: stranger.account }), "NotKeeper");
      await expectRevert(vault.write.hedgeOpen([ETH, USD(10), 2n * P10, 0n, P10], { account: keeper.account }), "PlanDisabled");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 4n * P10, 0n, P10], { account: keeper.account }), "LeverageTooHigh");
      await expectRevert(vault.write.hedgeOpen([WTI, USD(51), 2n * P10, 0n, P10], { account: keeper.account }), "NotionalTooHigh");
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, 0n, P10], { account: keeper.account }); // exactly $100
      expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 1n * P10, 0n, P10], { account: keeper.account }), "TooSoon");
    });

    it("opens a market at most once an hour, and one position at a time", async () => {
      const { keeper, vault, later } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, 0n, P10], { account: keeper.account });
      await later(3000);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), P10, 0n, P10], { account: keeper.account }), "TooSoon");
      await later(600);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(10), P10, 0n, P10], { account: keeper.account }), "PositionExists");
      await vault.write.hedgeClose([WTI, 0n, USD(50), 0n], { account: keeper.account });
      await vault.write.hedgeOpen([WTI, USD(10), P10, 0n, P10], { account: keeper.account });
    });

    it("keeps the keeper away from the money", async () => {
      const { owner, keeper, vault, usdc } = await deployFixture();
      const k = { account: keeper.account };
      await expectRevert(vault.write.withdraw([keeper.account.address, USD(1)], k), "NotOwner");
      await expectRevert(vault.write.setPlan([WTI, true, true, 50n * P10, USD(1e6)], k), "NotOwner");
      await expectRevert(vault.write.setKeeper([keeper.account.address], k), "NotOwner");
      await expectRevert(vault.write.transferOwnership([keeper.account.address], k), "NotOwner");
      await expectRevert(vault.write.sweepEth([keeper.account.address], k), "NotOwner");
      await expectRevert(vault.write.rescueToken([usdc.address, keeper.account.address, 1n], k), "NotOwner");
      await expectRevert(vault.write.ownerUpdateMargin([WTI, 0n, 1, USD(1), [], 1], k), "NotOwner");
      await expectRevert(vault.write.ownerClose([WTI, 0n, USD(1), 0n], k), "NotOwner");
      expect(lower(await vault.read.owner())).to.equal(lower(owner.account.address));
    });

    it("tops up margin only up to the plan's cap", async () => {
      const { keeper, veranta, vault } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
      await vault.write.topUpMargin([WTI, 0n, USD(10), ["0x01"], 1], { account: keeper.account, value: 7n });
      expect(await veranta.read.lastValue()).to.equal(7n);
      expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
      await vault.write.topUpMargin([WTI, 0n, USD(50), [], 1], { account: keeper.account }); // collateral $100 = cap
      await expectRevert(vault.write.topUpMargin([WTI, 0n, 1n, [], 1], { account: keeper.account }), "CollateralTooHigh");
      await expectRevert(vault.write.topUpMargin([WTI, 0n, 0n, [], 1], { account: keeper.account }), "ZeroAmount");
    });

    it("sends close proceeds back to the vault", async () => {
      const { keeper, vault, usdcOf } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
      expect(await usdcOf(vault.address)).to.equal(USD(260));
      await vault.write.hedgeClose([WTI, 0n, USD(40), 0n], { account: keeper.account });
      expect(await usdcOf(vault.address)).to.equal(USD(300));
    });
  });

  describe("fee", () => {
    it("charges the vault's fee on each open, to Locke's collector", async () => {
      const { keeper, collector, vault, usdcOf } = await deployFixture({ feeBps: 10 });
      expect(await vault.read.feeBps()).to.equal(10);
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, 0n, P10], { account: keeper.account }); // $100 notional
      expect(await usdcOf(collector.account.address)).to.equal(USD(0.1)); // 0.10%
      expect(await usdcOf(vault.address)).to.equal(USD(300 - 50 - 0.1));
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
      await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, 0n, P10], { account: keeper.account });
      expect(await usdcOf(collector.account.address)).to.equal(0n);
    });
  });

  describe("owner", () => {
    it("removes the keeper and exits alone", async () => {
      const { owner, keeper, veranta, vault, usdcOf } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
      await vault.write.setKeeper([zeroAddress], { account: owner.account });
      await expectRevert(vault.write.hedgeClose([WTI, 0n, USD(40), 0n], { account: keeper.account }), "NotKeeper");
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
    it("pauses new deposits and hedges, never exits", async () => {
      const { owner, keeper, guardian, stranger, vault, usdc, usdcOf } = await deployFixture();
      await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
      await expectRevert(vault.write.setPaused([true], { account: stranger.account }), "NotGuardian");
      await vault.write.setPaused([true], { account: guardian.account });
      await usdc.write.approve([vault.address, USD(1)], { account: owner.account });
      await expectRevert(vault.write.deposit([USD(1)], { account: owner.account }), "IsPaused");
      await vault.write.topUpMargin([WTI, 0n, USD(5), [], 1], { account: keeper.account });
      await vault.write.hedgeClose([WTI, 0n, USD(45), 0n], { account: keeper.account });
      await expectRevert(vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account }), "IsPaused");
      const before = await usdcOf(owner.account.address);
      await vault.write.withdraw([owner.account.address, USD(300)], { account: owner.account });
      expect((await usdcOf(owner.account.address)) - before).to.equal(USD(300));
    });

    it("pauses every vault from the factory, and follows a new guardian", async () => {
      const { admin, owner, keeper, guardian, stranger, factory, vault, createVault, owner2 } = await deployFixture();
      await factory.write.setPaused([true], { account: guardian.account });
      expect(await vault.read.paused()).to.equal(true);
      await expectRevert(vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account }), "IsPaused");
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

  describe("admin", () => {
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
