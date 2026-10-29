import hre from "hardhat";
import { parseEventLogs, type Address } from "viem";
import { P10, USD } from "./helpers";

export const WTI = 96n, ETH = 0n;
export const HOUR = 3600;

/** A factory on a mock Veranta, and one vault (long WTI, up to 3x and $100 notional) funded with $300. */
export async function deployFixture(opts: { feeBps?: number; maxVault?: bigint; maxTotal?: bigint } = {}) {
  const pub = await hre.viem.getPublicClient();
  const testClient = await hre.viem.getTestClient();
  const [owner, keeper, guardian, admin, stranger, collector, owner2] = await hre.viem.getWalletClients();
  const usdc = await hre.viem.deployContract("MockUSDC");
  const veranta = await hre.viem.deployContract("MockVeranta", [usdc.address]);
  const factory = await hre.viem.deployContract("LockeVaultFactory", [
    admin.account.address,
    guardian.account.address,
    keeper.account.address,
    usdc.address,
    veranta.address,
    veranta.address,
    opts.maxVault ?? USD(10_000),
    opts.maxTotal ?? USD(100_000),
  ]);
  if (opts.feeBps) await factory.write.setFee([opts.feeBps, collector.account.address], { account: admin.account });

  for (const w of [owner, owner2, stranger]) await usdc.write.mint([w.account.address, USD(10_000)]);

  async function createVault(by = owner, deposit = USD(300), plan = { enabled: true, buy: true, maxLeverage: 3n * P10, maxNotional: USD(100) }, pair = WTI) {
    await usdc.write.approve([factory.address, deposit], { account: by.account });
    const hash = await factory.write.createVault([pair, plan, deposit], { account: by.account });
    const [ev] = parseEventLogs({ abi: factory.abi, logs: (await pub.waitForTransactionReceipt({ hash })).logs, eventName: "VaultCreated" });
    return hre.viem.getContractAt("LockeVault", ev.args.vault);
  }

  const vault = await createVault();
  const usdcOf = (a: Address) => usdc.read.balanceOf([a]);
  const later = async (seconds = HOUR) => {
    await testClient.increaseTime({ seconds });
    await testClient.mine({ blocks: 1 });
  };
  return { pub, testClient, owner, keeper, guardian, admin, stranger, collector, owner2, usdc, veranta, factory, vault, createVault, usdcOf, later };
}
