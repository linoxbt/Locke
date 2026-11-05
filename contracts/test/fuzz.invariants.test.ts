/**
 * Property-based tests: random sequences of actions by every role (owner, keeper, guardian,
 * admin, a stranger), with random amounts, markets, limits and time jumps, against a mock
 * Veranta. After every step the vault's safety rules must hold:
 *
 *  1. Money only moves between the owner, the vault, Veranta and Locke's fee collector:
 *     vault USDC + collateral at Veranta + fees paid + hedge losses = initial funding + deposits - withdrawals.
 *  2. Fees never exceed 0.20% of the notional the keeper opened.
 *  3. Only the current owner withdraws, changes limits, closes, moves margin directly or changes
 *     the keeper; only the admin rotates the factory's keeper, which following vaults then use.
 *  4. Every keeper open respected the plan at that moment (leverage, collateral, notional,
 *     cooldown, one position), every top-up kept the position within the collateral cap and the
 *     two-minute cooldown, no open succeeded while paused, and no one but the owner deposited
 *     while paused.
 *  5. The owner can always exit: close every hedge and withdraw every dollar, even while paused
 *     and with no keeper. Checked on a snapshot after every step, then rolled back.
 *  6. The factory's total deposits equal the sum of every vault's net deposits, and after a
 *     deposit or a sync the vault's net deposits never exceed what it holds (losses are counted off).
 *  7. A new owner never inherits the previous owner's keeper: after a handover the vault follows
 *     the factory's.
 *
 * FUZZ_RUNS sets the number of random sequences (default 150).
 */
import hre from "hardhat";
import { expect } from "chai";
import fc from "fast-check";
import { zeroAddress, type Address } from "viem";
import { P10, USD } from "./helpers";
import { deployFixture, WTI, ETH, PX } from "./fixture";

const RUNS = Number(process.env.FUZZ_RUNS ?? 150);
const FEE_BPS = 20;
const PAIRS = [WTI, ETH] as const;
const ACTORS = ["owner", "keeper", "guardian", "admin", "stranger"] as const;
type Actor = (typeof ACTORS)[number];

const actor = fc.constantFrom(...ACTORS);
/** Mostly the role an action belongs to, sometimes anyone, so both the paths and the guards get exercised. */
const mostly = (role: Actor) => fc.oneof({ weight: 4, arbitrary: fc.constant(role) }, { weight: 1, arbitrary: actor });
const pair = fc.constantFrom(...PAIRS);
const usd = (max: number) => fc.integer({ min: 0, max: max * 100 }).map((c) => BigInt(c) * 10_000n); // cents
const lev = fc.integer({ min: 5, max: 60 }).map((t) => (BigInt(t) * P10) / 10n); // 0.5x to 6x
/** Mostly sizes a plan allows (the fixture plan is 3x, $100 notional and $100 collateral), sometimes anything. */
const openSize = fc.oneof(
  { weight: 3, arbitrary: fc.record({ collateral: usd(45), leverage: fc.integer({ min: 10, max: 22 }).map((t) => (BigInt(t) * P10) / 10n) }) },
  { weight: 1, arbitrary: fc.record({ collateral: usd(150), leverage: lev }) },
);

const w = <T,>(weight: number, arbitrary: fc.Arbitrary<T>) => ({ weight, arbitrary });
const action = fc.oneof(
  w(2, fc.record({ kind: fc.constant("deposit" as const), by: mostly("owner"), amount: usd(400) })),
  w(2, fc.record({ kind: fc.constant("withdraw" as const), by: mostly("owner"), amount: usd(500) })),
  w(6, fc.record({ kind: fc.constant("hedgeOpen" as const), by: mostly("keeper"), pair: fc.oneof(w(3, fc.constant(WTI)), w(1, fc.constant(ETH))), size: openSize })),
  w(3, fc.record({ kind: fc.constant("topUp" as const), by: mostly("keeper"), pair, amount: usd(60) })),
  // The keeper never closes; the owner closes all or part of a hedge.
  w(3, fc.record({ kind: fc.constant("ownerClose" as const), by: mostly("owner"), pair, part: fc.oneof(w(1, fc.constant(100)), w(2, fc.integer({ min: 1, max: 100 }))) })),
  w(1, fc.record({ kind: fc.constant("ownerMargin" as const), by: mostly("owner"), pair, withdraw: fc.boolean(), amount: usd(60) })),
  w(1, fc.record({ kind: fc.constant("setPlan" as const), by: mostly("owner"), pair, enabled: fc.boolean(), buy: fc.boolean(), maxLeverage: lev, maxNotional: usd(300), maxCollateral: usd(150) })),
  w(1, fc.record({ kind: fc.constant("setKeeper" as const), by: mostly("owner"), to: fc.option(actor, { nil: undefined }) })),
  w(1, fc.record({ kind: fc.constant("followFactoryKeeper" as const), by: mostly("owner") })),
  w(1, fc.record({ kind: fc.constant("factorySetKeeper" as const), by: mostly("admin"), to: fc.option(actor, { nil: undefined }) })),
  w(1, fc.record({ kind: fc.constant("pauseVault" as const), by: mostly("guardian"), on: fc.boolean() })),
  w(1, fc.record({ kind: fc.constant("pauseAll" as const), by: mostly("guardian"), on: fc.boolean() })),
  w(1, fc.record({ kind: fc.constant("transferOwnership" as const), by: mostly("owner"), to: actor })),
  w(1, fc.record({ kind: fc.constant("acceptOwnership" as const), by: actor, asPending: fc.boolean() })),
  w(3, fc.record({ kind: fc.constant("warp" as const), seconds: fc.integer({ min: 1, max: 7200 }) })),
  // Veranta, not a role: a hedge ends at a loss (a losing close or a liquidation), then anyone syncs.
  w(1, fc.record({ kind: fc.constant("loss" as const), pair, part: fc.integer({ min: 1, max: 100 }) })),
  w(1, fc.record({ kind: fc.constant("sync" as const), by: actor })),
);

describe("LockeVault invariants (property-based)", function () {
  this.timeout(1_800_000);

  it(`hold over ${RUNS} random sequences of actions`, async () => {
    const f = await deployFixture({ feeBps: FEE_BPS });
    const { pub, testClient, usdc, veranta, factory, vault, collector } = f;
    const wallets: Record<Actor, typeof f.owner> = { owner: f.owner, keeper: f.keeper, guardian: f.guardian, admin: f.admin, stranger: f.stranger };
    const addr = (a: Actor) => wallets[a].account.address;
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    for (const a of ACTORS) await usdc.write.mint([addr(a), USD(5_000)]);
    for (const a of ACTORS) await usdc.write.approve([vault.address, USD(1e9)], { account: wallets[a].account });

    // A Hardhat snapshot can be reverted to once, so each sequence takes a fresh one after reverting.
    let base = await testClient.snapshot();
    let sequences = 0, steps = 0, succeeded = 0;
    const accepted: Record<string, number> = {};

    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 4, maxLength: 24 }), async (actions) => {
        await testClient.revert({ id: base });
        base = await testClient.snapshot();
        const initial = USD(300);
        let deposits = 0n, withdrawals = 0n, notionalOpened = 0n, lost = 0n;
        const feesBefore = await usdc.read.balanceOf([collector.account.address]);

        for (const a of actions) {
          steps++;
          if (a.kind === "warp") {
            await testClient.increaseTime({ seconds: a.seconds });
            await testClient.mine({ blocks: 1 });
            continue;
          }
          if (a.kind === "loss") {
            const coll = await veranta.read.collateralOf([vault.address, a.pair]);
            if (coll === 0n) continue;
            const loss = (coll * BigInt(a.part)) / 100n;
            await veranta.write.closeAtLoss([vault.address, a.pair, loss]);
            lost += loss;
            continue;
          }
          const by = wallets[a.by];
          const owner = await vault.read.owner();
          const keeper = await vault.read.keeper();
          const follows = await vault.read.keeperFollowsFactory();
          // 3: a following vault's keeper is the factory's; an owner-picked one is not touched by it.
          if (follows) expect(same(keeper, await factory.read.keeper()), "following vault's keeper is not the factory's").to.equal(true);
          const paused = await vault.read.paused();
          const isOwner = same(addr(a.by), owner);
          let ok = true;
          const run = async (p: Promise<unknown>) => {
            try {
              await p;
            } catch {
              ok = false;
            }
          };

          switch (a.kind) {
            case "deposit":
              await run(vault.write.deposit([a.amount], { account: by.account }));
              if (ok) {
                expect(!paused || isOwner, "someone other than the owner deposited while paused").to.equal(true);
                deposits += a.amount;
              }
              break;
            case "withdraw":
              await run(vault.write.withdraw([addr(a.by), a.amount], { account: by.account }));
              if (ok) {
                expect(isOwner, "only the owner withdraws").to.equal(true);
                withdrawals += a.amount;
              }
              break;
            case "hedgeOpen": {
              const plan = await vault.read.plans([a.pair]);
              const last = await vault.read.lastOpenAt([a.pair]);
              const open = await veranta.read.openCount([vault.address, a.pair]);
              const now = (await pub.getBlock()).timestamp;
              await run(vault.write.hedgeOpen([a.pair, a.size.collateral, a.size.leverage, PX, P10], { account: by.account }));
              if (ok) {
                const notional = (a.size.collateral * a.size.leverage) / P10;
                expect(same(addr(a.by), keeper), "only the keeper opens").to.equal(true);
                expect(paused, "open while paused").to.equal(false);
                expect(plan[0], "open on a disabled plan").to.equal(true);
                expect(a.size.leverage <= plan[2], "leverage above the plan").to.equal(true);
                expect(notional <= plan[3], "notional above the plan").to.equal(true);
                expect(a.size.collateral <= plan[4], "collateral above the plan").to.equal(true);
                expect(open, "second position").to.equal(0n);
                expect(now + 1n >= last + 3600n, "open inside the cooldown").to.equal(true);
                notionalOpened += notional;
              }
              break;
            }
            case "topUp": {
              const coll = await veranta.read.collateralOf([vault.address, a.pair]);
              const plan = await vault.read.plans([a.pair]);
              const last = await vault.read.lastTopUpAt([a.pair]);
              const now = (await pub.getBlock()).timestamp;
              await run(vault.write.topUpMargin([a.pair, 0n, a.amount, [], 1], { account: by.account }));
              if (ok) {
                expect(same(addr(a.by), keeper), "only the keeper tops up").to.equal(true);
                expect(coll + a.amount <= plan[4], "top-up past the plan's collateral cap").to.equal(true);
                expect(now + 1n >= last + 120n, "top-up inside the cooldown").to.equal(true);
              }
              break;
            }
            case "ownerClose": {
              const coll = await veranta.read.collateralOf([vault.address, a.pair]);
              await run(vault.write.ownerClose([a.pair, 0n, (coll * BigInt(a.part)) / 100n, 0n], { account: by.account }));
              if (ok) expect(isOwner, "only the owner closes").to.equal(true);
              break;
            }
            case "ownerMargin":
              await run(vault.write.ownerUpdateMargin([a.pair, 0n, a.withdraw ? 1 : 0, a.amount, [], 1], { account: by.account }));
              if (ok) expect(isOwner, "only the owner moves margin directly").to.equal(true);
              break;
            case "setPlan":
              await run(vault.write.setPlan([a.pair, a.enabled, a.buy, a.maxLeverage, a.maxNotional, a.maxCollateral], { account: by.account }));
              if (ok) expect(isOwner, "only the owner sets limits").to.equal(true);
              break;
            case "setKeeper":
              await run(vault.write.setKeeper([a.to ? addr(a.to) : zeroAddress], { account: by.account }));
              if (ok) {
                expect(isOwner, "only the owner sets the keeper").to.equal(true);
                expect(await vault.read.keeperFollowsFactory(), "own keeper still follows the factory").to.equal(false);
              }
              break;
            case "followFactoryKeeper":
              await run(vault.write.followFactoryKeeper({ account: by.account }));
              if (ok) expect(isOwner, "only the owner hands the keeper back to the factory").to.equal(true);
              break;
            case "factorySetKeeper":
              await run(factory.write.setKeeper([a.to ? addr(a.to) : zeroAddress], { account: by.account }));
              if (ok) {
                expect(a.by, "only the admin rotates the factory's keeper").to.equal("admin");
                // A vault on its own keeper is unaffected by the rotation.
                if (!follows) expect(same(await vault.read.keeper(), keeper), "rotation moved an owner-picked keeper").to.equal(true);
              }
              break;
            case "pauseVault":
              await run(vault.write.setPaused([a.on], { account: by.account }));
              if (ok) expect(a.by, "only the guardian pauses").to.equal("guardian");
              break;
            case "pauseAll":
              await run(factory.write.setPaused([a.on], { account: by.account }));
              if (ok) expect(a.by, "only the guardian pauses").to.equal("guardian");
              break;
            case "transferOwnership":
              await run(vault.write.transferOwnership([addr(a.to)], { account: by.account }));
              if (ok) expect(isOwner, "only the owner hands over").to.equal(true);
              break;
            case "acceptOwnership": {
              const pending = await vault.read.pendingOwner();
              // Half the time the named new owner accepts, so handovers happen often enough to check 7.
              const caller = (a.asPending && Object.values(wallets).find((w) => same(w.account.address, pending))) || by;
              await run(vault.write.acceptOwnership({ account: caller.account }));
              if (ok) {
                expect(same(caller.account.address, pending), "only the named new owner accepts").to.equal(true);
                // 7: the previous owner's keeper doesn't come along.
                expect(await vault.read.keeperFollowsFactory(), "new owner inherited a keeper").to.equal(true);
              }
              break;
            }
            case "sync":
              await run(vault.write.syncDeposits({ account: by.account }));
              expect(ok, "sync refused").to.equal(true);
              break;
          }
          if (ok) {
            succeeded++;
            accepted[a.kind] = (accepted[a.kind] ?? 0) + 1;
          }

          // 1 and 2: where the money is.
          const inVault = await usdc.read.balanceOf([vault.address]);
          const atVeranta = (await veranta.read.collateralOf([vault.address, WTI])) + (await veranta.read.collateralOf([vault.address, ETH]));
          const fees = (await usdc.read.balanceOf([collector.account.address])) - feesBefore;
          expect(inVault + atVeranta + fees + lost, "money left the owner/vault/Veranta/fee circle").to.equal(initial + deposits - withdrawals);
          expect(fees <= (notionalOpened * BigInt(FEE_BPS)) / 10_000n, "fee above 0.20% of notional").to.equal(true);
          // 6: launch-cap accounting.
          const net = await vault.read.netDeposits();
          expect(await factory.read.totalDeposits(), "factory total").to.equal(net);
          if (ok && (a.kind === "deposit" || a.kind === "sync")) expect(net <= inVault + atVeranta, "net deposits above what the vault holds").to.equal(true);
        }

        // 5: the owner can always get everything out, paused or not, keeper or not.
        const exit = await testClient.snapshot();
        const owner = (await vault.read.owner()) as Address;
        const ownerWallet = Object.values(wallets).find((w) => same(w.account.address, owner))!;
        await vault.write.setKeeper([zeroAddress], { account: ownerWallet.account });
        for (const p of PAIRS) {
          const coll = await veranta.read.collateralOf([vault.address, p]);
          if (coll > 0n) await vault.write.ownerClose([p, 0n, coll, 0n], { account: ownerWallet.account });
        }
        const all = await usdc.read.balanceOf([vault.address]);
        const before = await usdc.read.balanceOf([owner]);
        if (all > 0n) await vault.write.withdraw([owner, all], { account: ownerWallet.account });
        expect(await usdc.read.balanceOf([vault.address])).to.equal(0n);
        expect((await usdc.read.balanceOf([owner])) - before).to.equal(all);
        await testClient.revert({ id: exit });
        sequences++;
      }),
      { numRuns: RUNS, verbose: 1 },
    );
    console.log(`      ${sequences} sequences, ${steps} steps, ${succeeded} accepted by the contracts`);
    console.log(`      accepted: ${JSON.stringify(accepted)}`);
  });
});

void hre;
