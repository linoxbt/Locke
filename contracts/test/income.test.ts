/**
 * "Protect as you get paid": the keeper moves part of the owner's incoming USDC from the owner's
 * Base Account into the vault under a spend permission. Uses a stand-in for Base Account's
 * SpendPermissionManager at its real address; the fork test runs the real one.
 */
import hre from "hardhat";
import { expect } from "chai";
import { type Address, type Hex, toHex } from "viem";
import { deployFixture } from "./fixture";
import { expectRevert, USD } from "./helpers";

const MANAGER: Address = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";
const SIGNED = toHex("owner-signed");

async function setup(opts: Parameters<typeof deployFixture>[0] = {}) {
  const f = await deployFixture(opts);
  const mock = await hre.viem.deployContract("MockSpendPermissionManager");
  const code = (await f.pub.getCode({ address: mock.address })) as Hex;
  await f.testClient.setCode({ address: MANAGER, bytecode: code });
  // A Base Account lets the manager move its funds; the stand-in pulls with an ERC-20 allowance.
  await f.usdc.write.approve([MANAGER, USD(1_000_000)], { account: f.owner.account });
  const permission = (over: Partial<Permission> = {}): Permission => ({
    account: f.owner.account.address,
    spender: f.vault.address,
    token: f.usdc.address,
    allowance: USD(100),
    period: 7 * 86400,
    start: 0,
    end: 2 ** 40,
    salt: 1n,
    extraData: "0x",
    ...over,
  });
  return { ...f, permission };
}

interface Permission {
  account: Address;
  spender: Address;
  token: Address;
  allowance: bigint;
  period: number;
  start: number;
  end: number;
  salt: bigint;
  extraData: Hex;
}

describe("LockeVault: protect as you get paid", () => {
  it("moves the owner's USDC into the vault, approving with the signature the first time", async () => {
    const { vault, keeper, owner, permission, usdcOf, factory } = await setup();
    const before = { vault: await usdcOf(vault.address), owner: await usdcOf(owner.account.address), net: await vault.read.netDeposits(), total: await factory.read.totalDeposits() };
    await vault.write.collectIncome([permission(), SIGNED, USD(40)], { account: keeper.account });
    await vault.write.collectIncome([permission(), "0x", USD(25)], { account: keeper.account }); // approved now: no signature needed
    expect(await usdcOf(vault.address)).to.equal(before.vault + USD(65));
    expect(await usdcOf(owner.account.address)).to.equal(before.owner - USD(65));
    expect(await vault.read.netDeposits()).to.equal(before.net + USD(65));
    expect(await factory.read.totalDeposits()).to.equal(before.total + USD(65));
  });

  it("never takes more than the owner allowed", async () => {
    const { vault, keeper, permission } = await setup();
    await vault.write.collectIncome([permission(), SIGNED, USD(90)], { account: keeper.account });
    await expectRevert(vault.write.collectIncome([permission(), "0x", USD(11)], { account: keeper.account }), "ExceededSpendPermission");
  });

  it("only the keeper collects, and only the owner's money into this vault, in USDC", async () => {
    const { vault, keeper, owner, stranger, owner2, usdc, permission } = await setup();
    await expectRevert(vault.write.collectIncome([permission(), SIGNED, USD(1)], { account: stranger.account }), "NotKeeper");
    await expectRevert(vault.write.collectIncome([permission(), SIGNED, USD(1)], { account: owner.account }), "NotKeeper");
    await expectRevert(vault.write.collectIncome([permission({ account: owner2.account.address }), SIGNED, USD(1)], { account: keeper.account }), "BadPermission");
    await expectRevert(vault.write.collectIncome([permission({ spender: keeper.account.address }), SIGNED, USD(1)], { account: keeper.account }), "BadPermission");
    await expectRevert(vault.write.collectIncome([permission({ token: stranger.account.address }), SIGNED, USD(1)], { account: keeper.account }), "BadPermission");
    await expectRevert(vault.write.collectIncome([permission(), SIGNED, 0n], { account: keeper.account }), "ZeroAmount");
    expect(await usdc.read.balanceOf([keeper.account.address])).to.equal(0n);
  });

  it("stops while paused and above the launch caps, like any deposit", async () => {
    const { vault, keeper, guardian, permission } = await setup({ maxVault: USD(320) });
    await expectRevert(vault.write.collectIncome([permission(), SIGNED, USD(21)], { account: keeper.account }), "VaultCapReached");
    await vault.write.setPaused([true], { account: guardian.account });
    await expectRevert(vault.write.collectIncome([permission(), SIGNED, USD(5)], { account: keeper.account }), "IsPaused");
  });

  it("an unsigned permission is refused by the manager", async () => {
    const { vault, keeper, permission } = await setup();
    await expectRevert(vault.write.collectIncome([permission(), "0x", USD(5)], { account: keeper.account }), "UnauthorizedSpendPermission");
  });
});
