// Public metrics: what Locke protects right now on Strike (Cardano) and Base, from Locke's own
// records. Aggregates only; nothing here names a business or a wallet.

import { baseMarket } from "../base/contracts";
import { db } from "./db";

export interface Metrics {
  /** USD of hedges open right now, both networks. */
  protectedUsd: number;
  strike: { activePlans: number; protectedUsd: number; /** Plans that got as far as opening a hedge. */ plansCreated: number };
  base: {
    activeVaults: number;
    protectedUsd: number;
    vaultsCreated: number;
    /** Live "Protected by Locke" attestations. */
    liveProofs: number;
    /** Distinct Base transactions Locke recorded: vault creations and keeper transactions, all carrying its Builder Code. */
    builderCodeTxs: number;
  };
  /** Latest live proofs (public anyway, on EAS). */
  proofs: { uid: string; market: string; protectedUsd: number; at: string }[];
  at: string;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function readMetrics(): Promise<Metrics> {
  const sql = db();
  const [[strike], [base], [txs], proofs] = await Promise.all([
    sql`
      select count(*) filter (where status = 'active') as active,
             coalesce(sum((sizing->>'notional')::numeric) filter (where status = 'active'), 0) as usd,
             count(*) filter (where status in ('opening', 'active', 'closing', 'closed')) as created
      from plans`,
    sql`
      select count(*) filter (where status = 'active') as active,
             coalesce(sum((sizing->>'notionalUsd')::numeric) filter (where status = 'active'), 0) as usd,
             count(*) as created
      from base_vaults`,
    sql`
      select count(distinct tx) as n from (
        select created_tx as tx from base_vaults
        union select tx_hash from base_vault_events where tx_hash is not null
      ) t`,
    sql`
      select e.detail->>'attestation' as uid, v.pair_index, v.sizing, e.created_at
      from base_vault_events e join base_vaults v on v.address = e.vault
      where e.detail ? 'attestation'
        and not exists (select 1 from base_vault_events r where r.vault = e.vault and r.detail->>'revoked' = e.detail->>'attestation')
      order by e.id desc`,
  ]);
  const strikeUsd = num(strike.usd);
  const baseUsd = num(base.usd);
  return {
    protectedUsd: strikeUsd + baseUsd,
    strike: { activePlans: num(strike.active), protectedUsd: strikeUsd, plansCreated: num(strike.created) },
    base: {
      activeVaults: num(base.active),
      protectedUsd: baseUsd,
      vaultsCreated: num(base.created),
      liveProofs: proofs.length,
      builderCodeTxs: num(txs.n),
    },
    proofs: proofs.slice(0, 6).map((p) => ({
      uid: String(p.uid),
      market: baseMarket(Number(p.pair_index))?.symbol ?? "—",
      protectedUsd: num((p.sizing as { notionalUsd?: number }).notionalUsd),
      at: new Date(p.created_at).toISOString(),
    })),
    at: new Date().toISOString(),
  };
}
