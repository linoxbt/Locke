/** Offline unit tests for the vault's roles and limits, against a mock Veranta. */
import hre from "hardhat";
import { expect } from "chai";
import { parseEventLogs, zeroAddress } from "viem";
import { P10, USD, expectRevert } from "./helpers";

const WTI = 96n, ETH = 0n;

async function setup() {
  const pub = await hre.viem.getPublicClient();
  const [owner, keeper, guardian, stranger] = await hre.viem.getWalletClients();
  const usdc = await hre.viem.deployContract("MockUSDC");
  const veranta = await hre.viem.deployContract("MockVeranta", [usdc.address]);
  const factory = await hre.viem.deployContract("LockeVaultFactory", [
    keeper.account.address, guardian.account.address, usdc.address, veranta.address, veranta.address,
  ]);
  await usdc.write.mint([owner.account.address, USD(1000)]);
  await usdc.write.approve([factory.address, USD(300)], { account: owner.account });
  const hash = await factory.write.createVault([{ pairIndex: WTI, buy: true, maxLeverage: 3n * P10, maxNotional: USD(100) }, USD(300)], {
    account: owner.account,
  });
  const [ev] = parseEventLogs({ abi: factory.abi, logs: (await pub.waitForTransactionReceipt({ hash })).logs, eventName: "VaultCreated" });
  const vault = await hre.viem.getContractAt("LockeVault", ev.args.vault);
  return { pub, owner, keeper, guardian, stranger, usdc, veranta, factory, vault };
}

describe("LockeVault (unit)", () => {
  it("belongs to the wallet that created it, funded and with its first plan", async () => {
    const { owner, keeper, guardian, usdc, vault } = await setup();
    expect((await vault.read.owner()).toLowerCase()).to.equal(owner.account.address.toLowerCase());
    expect((await vault.read.keeper()).toLowerCase()).to.equal(keeper.account.address.toLowerCase());
    expect((await vault.read.guardian()).toLowerCase()).to.equal(guardian.account.address.toLowerCase());
    expect(await usdc.read.balanceOf([vault.address])).to.equal(USD(300));
    const [enabled, buy, maxLev, maxNotional] = await vault.read.plans([WTI]);
    expect([enabled, buy, maxLev, maxNotional]).to.deep.equal([true, true, 3n * P10, USD(100)]);
  });

  it("cannot be initialized twice, nor its implementation at all", async () => {
    const { owner, factory, vault, usdc, veranta } = await setup();
    const a = owner.account.address;
    await expectRevert(vault.write.initialize([a, a, a, usdc.address, veranta.address, veranta.address]), "InvalidInitialization");
    const impl = await hre.viem.getContractAt("LockeVault", await factory.read.implementation());
    await expectRevert(impl.write.initialize([a, a, a, usdc.address, veranta.address, veranta.address]), "InvalidInitialization");
  });

  it("lets the keeper hedge only within the plan", async () => {
    const { keeper, stranger, veranta, vault } = await setup();
    await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 2n * P10, 0n, P10], { account: stranger.account }), "NotKeeper");
    await expectRevert(vault.write.hedgeOpen([ETH, USD(10), 2n * P10, 0n, P10], { account: keeper.account }), "PlanDisabled");
    await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 4n * P10, 0n, P10], { account: keeper.account }), "LeverageTooHigh");
    await expectRevert(vault.write.hedgeOpen([WTI, USD(51), 2n * P10, 0n, P10], { account: keeper.account }), "NotionalTooHigh");
    await vault.write.hedgeOpen([WTI, USD(50), 2n * P10, 0n, P10], { account: keeper.account }); // exactly $100
    expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
    await expectRevert(vault.write.hedgeOpen([WTI, USD(10), 1n * P10, 0n, P10], { account: keeper.account }), "PositionExists");
  });

  it("keeps the keeper away from the money", async () => {
    const { owner, keeper, vault } = await setup();
    await expectRevert(vault.write.withdraw([keeper.account.address, USD(1)], { account: keeper.account }), "NotOwner");
    await expectRevert(vault.write.setPlan([WTI, true, true, 50n * P10, USD(1e6)], { account: keeper.account }), "NotOwner");
    await expectRevert(vault.write.setKeeper([keeper.account.address], { account: keeper.account }), "NotOwner");
    await expectRevert(vault.write.transferOwnership([keeper.account.address], { account: keeper.account }), "NotOwner");
    await expectRevert(vault.write.sweepEth([keeper.account.address], { account: keeper.account }), "NotOwner");
    await expectRevert(
      vault.write.ownerUpdateMargin([WTI, 0n, 1, USD(1), [], 1], { account: keeper.account }),
      "NotOwner",
    );
    expect((await vault.read.owner()).toLowerCase()).to.equal(owner.account.address.toLowerCase());
  });

  it("sends close proceeds and margin back to the vault and forwards the oracle fee", async () => {
    const { keeper, usdc, veranta, vault } = await setup();
    await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
    await vault.write.topUpMargin([WTI, 0n, USD(10), ["0x01"], 1], { account: keeper.account, value: 7n });
    expect(await veranta.read.lastValue()).to.equal(7n);
    expect(await veranta.read.collateralOf([vault.address, WTI])).to.equal(USD(50));
    await expectRevert(vault.write.topUpMargin([WTI, 0n, 0n, [], 1], { account: keeper.account }), "ZeroAmount");
    await vault.write.hedgeClose([WTI, 0n, USD(50), 0n], { account: keeper.account });
    expect(await usdc.read.balanceOf([vault.address])).to.equal(USD(300));
  });

  it("pauses new deposits and hedges, never exits", async () => {
    const { owner, keeper, guardian, stranger, usdc, vault } = await setup();
    await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
    await expectRevert(vault.write.setPaused([true], { account: stranger.account }), "NotGuardian");
    await vault.write.setPaused([true], { account: guardian.account });
    await expectRevert(vault.write.deposit([USD(1)], { account: owner.account }), "IsPaused");
    await vault.write.hedgeClose([WTI, 0n, USD(40), 0n], { account: keeper.account });
    await expectRevert(vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account }), "IsPaused");
    await vault.write.withdraw([owner.account.address, USD(300)], { account: owner.account });
    expect(await usdc.read.balanceOf([owner.account.address])).to.equal(USD(1000));
  });

  it("lets the owner remove the keeper and exit alone", async () => {
    const { owner, keeper, usdc, veranta, vault } = await setup();
    await vault.write.hedgeOpen([WTI, USD(40), 2n * P10, 0n, P10], { account: keeper.account });
    await vault.write.setKeeper([zeroAddress], { account: owner.account });
    await expectRevert(vault.write.hedgeClose([WTI, 0n, USD(40), 0n], { account: keeper.account }), "NotKeeper");
    await vault.write.ownerUpdateMargin([WTI, 0n, 1, USD(5), [], 1], { account: owner.account });
    await vault.write.ownerClose([WTI, 0n, USD(35), 0n], { account: owner.account });
    expect(await veranta.read.openCount([vault.address, WTI])).to.equal(0n);
    await vault.write.withdraw([owner.account.address, USD(300)], { account: owner.account });
    expect(await usdc.read.balanceOf([owner.account.address])).to.equal(USD(1000));
  });

  it("hands ownership over only by the owner", async () => {
    const { owner, stranger, vault } = await setup();
    await expectRevert(vault.write.transferOwnership([zeroAddress], { account: owner.account }), "ZeroAddress");
    await vault.write.transferOwnership([stranger.account.address], { account: owner.account });
    await expectRevert(vault.write.withdraw([owner.account.address, 1n], { account: owner.account }), "NotOwner");
    await vault.write.withdraw([stranger.account.address, 1n], { account: stranger.account });
  });
});
