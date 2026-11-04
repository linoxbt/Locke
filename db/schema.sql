-- Locke schema. Idempotent: safe to run on every deploy (`npm run db:migrate`).
-- Row-level security is on for every table with no policies: the app and keeper connect with a
-- server role that bypasses it, so a leaked public key reads nothing.

create extension if not exists pgcrypto;

-- One row per EVM address that signed in with Sign in with Base (lower-case hex).
create table if not exists base_users (
  id              uuid primary key default gen_random_uuid(),
  address         text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  session_version int  not null default 1,
  created_at      timestamptz not null default now()
);

-- Sign-in nonces: single use, 10-minute lifetime. network = the caller's IP bucket, for rate limits.
create table if not exists base_auth_nonces (
  nonce      text primary key,
  network    text,
  created_at timestamptz not null default now()
);
create index if not exists base_auth_nonces_created_idx on base_auth_nonces(created_at);
create index if not exists base_auth_nonces_network_idx on base_auth_nonces(network, created_at);

-- A business's LockeVault, recorded from the VaultCreated event of the transaction that made it.
create table if not exists base_vaults (
  address     text primary key check (address ~ '^0x[0-9a-f]{40}$'),
  user_id     uuid not null references base_users(id) on delete cascade,
  pair_index  int  not null,
  type        text not null check (type in ('holdings', 'costs')),
  name        text not null,
  inputs      jsonb not null,
  sizing      jsonb not null,
  status      text not null default 'funding' check (status in ('funding', 'opening', 'active', 'closed')),
  risk_level  text not null default 'ok',
  last_ratio  numeric,
  status_note text,
  created_tx  text not null,
  created_via text not null default 'app',      -- 'agent': registered through the agent API, without a session
  open_sent_at timestamptz,                    -- the keeper sent hedgeOpen; cleared once Veranta fills it
  topup_sent_at timestamptz,                   -- the keeper sent topUpMargin; cleared once Base shows the new margin
  topup_from_usd numeric,                      -- the hedge's margin on Base when that top-up was sent
  opened_at   timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Added after launch: columns the create table above has for new databases.
alter table base_vaults add column if not exists topup_sent_at timestamptz;
alter table base_vaults add column if not exists topup_from_usd numeric;
alter table base_vaults add column if not exists created_via text not null default 'app';
create index if not exists base_vaults_user_idx on base_vaults(user_id, created_at desc);

create table if not exists base_vault_events (
  id         bigserial primary key,
  vault      text not null references base_vaults(address) on delete cascade,
  level      text not null default 'info',
  message    text not null,
  detail     jsonb,
  tx_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists base_vault_events_vault_idx on base_vault_events(vault, id desc);
-- Proof lookups (live attestations, revocations) without scanning every event.
create index if not exists base_vault_events_attestation_idx on base_vault_events(vault) where detail ? 'attestation';
create index if not exists base_vault_events_revoked_idx on base_vault_events((detail->>'revoked')) where detail ? 'revoked';

alter table base_users        enable row level security;
alter table base_auth_nonces  enable row level security;
alter table base_vaults       enable row level security;
alter table base_vault_events enable row level security;

-- What a business asked for, saved just before its wallet creates the vault: if the page never
-- gets to record the vault, Locke finds it on Base and records it with these inputs.
create table if not exists base_vault_drafts (
  id         bigserial primary key,
  user_id    uuid not null references base_users(id) on delete cascade,
  inputs     jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists base_vault_drafts_user_idx on base_vault_drafts(user_id, id desc);
alter table base_vault_drafts enable row level security;

-- "Protect as you get paid": a vault owner's spend permission (signed by their Base Account, the
-- vault as spender) and what the keeper has counted and moved under it. One per vault.
create table if not exists base_income (
  vault          text primary key references base_vaults(address) on delete cascade,
  permission     jsonb not null,                -- the SpendPermission struct, big numbers as strings
  signature      text not null,                 -- used for the first collection, until approved on chain
  share_pct      int  not null check (share_pct between 5 and 50),
  status         text not null default 'on' check (status in ('on', 'off')),
  pending_usd    numeric not null default 0,    -- share of income counted but not yet moved
  collected_usd  numeric not null default 0,
  last_block     bigint not null,               -- income is counted from the block after this
  last_collected_at timestamptz,
  -- A collection sent but not yet booked (receipt timed out, or the keeper restarted): booked from
  -- its receipt on the next round, so the same income is never collected twice.
  inflight_tx    text,
  inflight_usd   numeric,
  inflight_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table base_income add column if not exists inflight_nonce bigint;   -- the signed collection's nonce and bytes,
alter table base_income add column if not exists inflight_raw text;       -- to resend it or know it can't land
alter table base_income enable row level security;

-- Agent API payments (x402) already used: one EIP-3009 authorization pays for one call, even when
-- the same signed payment is sent several times at once.
create table if not exists x402_payments (
  payer      text not null,
  nonce      text not null,
  resource   text not null,
  created_at timestamptz not null default now(),
  settled    boolean not null default false,
  primary key (payer, nonce)
);
alter table x402_payments add column if not exists settled boolean not null default false;
alter table x402_payments enable row level security;

-- The Base keeper's last round (one row, id 2), for checking that it's alive.
create table if not exists monitor_heartbeat (
  id      int primary key,
  at      timestamptz not null,
  result  jsonb
);
alter table monitor_heartbeat enable row level security;

-- Defense in depth: the app connects as a server role; the public API roles get nothing on
-- Locke's own tables. Only these tables: the database may hold other apps' tables too.
do $$
declare t text;
begin
  foreach t in array array['base_users', 'base_auth_nonces', 'base_vaults', 'base_vault_events', 'base_vault_drafts', 'base_income', 'x402_payments', 'monitor_heartbeat'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
  end loop;
end $$;
