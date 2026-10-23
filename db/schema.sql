-- Locke schema. Idempotent: safe to run on every deploy (`npm run db:migrate`).

create extension if not exists pgcrypto;

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  address       text not null unique,          -- bech32 payment address used with Strike
  stake_address text,
  created_at    timestamptz not null default now()
);

-- One builder-connected Strike API wallet per user. Only the server role reads the secret.
create table if not exists strike_links (
  user_id                 uuid primary key references users(id) on delete cascade,
  account_id              text not null,
  api_wallet_public_key   text not null,
  api_wallet_secret_enc   text not null,
  fee_share_bps           int  not null,
  expires_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Pending builder-connect challenges (5-minute lifetime on Strike's side).
create table if not exists connect_challenges (
  nonce                   text primary key,
  address                 text not null,
  stake_address           text,
  api_wallet_public_key   text not null,
  api_wallet_secret_enc   text not null,
  fee_share_bps           int  not null,
  created_at              timestamptz not null default now()
);

create table if not exists plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  type          text not null check (type in ('holdings', 'costs')),
  name          text not null,
  symbol        text not null,
  side          text not null check (side in ('buy', 'sell')),
  status        text not null default 'draft'
                check (status in ('draft', 'funding', 'opening', 'active', 'closing', 'closed', 'failed')),
  inputs        jsonb not null,                 -- form inputs; both plan types share this table
  sizing        jsonb not null,                 -- sizing at preview time
  size          numeric not null,               -- hedge size currently intended (base units)
  entry_price   numeric,
  buffer_added  boolean not null default false,
  risk_level    text not null default 'ok',
  last_ratio    numeric,
  status_note   text,
  opened_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists plans_user_idx on plans(user_id, created_at desc);
-- One live plan per market per user (isolated margin on the main account holds one position per market).
create unique index if not exists plans_one_live_per_market
  on plans(user_id, symbol) where status in ('funding', 'opening', 'active', 'closing');

create table if not exists deposits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  plan_id     uuid references plans(id) on delete set null,
  purpose     text not null check (purpose in ('open', 'topup')),
  request_id  text not null unique,
  lovelace    numeric not null,
  usd_value   numeric not null,
  tx_hash     text,
  status      text not null default 'built' check (status in ('built', 'submitted', 'credited', 'applied', 'failed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists deposits_plan_idx on deposits(plan_id, created_at desc);

create table if not exists plan_events (
  id         bigserial primary key,
  plan_id    uuid not null references plans(id) on delete cascade,
  level      text not null default 'info',     -- info | watch | action | margin_call | reduce_only | liquidation | ok
  message    text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists plan_events_plan_idx on plan_events(plan_id, id desc);

create table if not exists snapshots (
  id          bigserial primary key,
  plan_id     uuid not null references plans(id) on delete cascade,
  mark        numeric not null,
  ratio       numeric,
  upnl        numeric,
  iso_balance numeric,
  funding     numeric,
  headline    numeric,
  created_at  timestamptz not null default now()
);
create index if not exists snapshots_plan_idx on snapshots(plan_id, created_at);

-- Row-level security: the app and worker connect with a server role that bypasses RLS.
-- Enabling it with no policies means a leaked anon key can read nothing.
alter table users              enable row level security;
alter table strike_links       enable row level security;
alter table connect_challenges enable row level security;
alter table plans              enable row level security;
alter table deposits           enable row level security;
alter table plan_events        enable row level security;
alter table snapshots          enable row level security;

-- ── Hardening (audit, 2026-10-23). Idempotent additions to the tables above. ──

-- Sessions: signing out bumps the version, which revokes every token issued before it.
alter table users add column if not exists session_version int not null default 1;

-- Orders: one tracked order in flight per plan, with a deterministic client id
-- locke-{planId}-{action}-{seq}. Strike is asked about that exact id when an outcome is unclear.
alter table plans add column if not exists order_seq      int not null default 0;
alter table plans add column if not exists pending_order  text;
alter table plans add column if not exists pending_action text check (pending_action in ('open','close','resize'));
alter table plans add column if not exists pending_meta   jsonb;
alter table plans add column if not exists pending_since  timestamptz;
-- A live plan whose position briefly disappears is only closed after a grace period.
alter table plans add column if not exists missing_since  timestamptz;
-- Risk disclosures accepted (server-side, required before any deposit or order).
alter table plans add column if not exists risk_ack_at    timestamptz;

-- Deposits: what was actually added to margin, and one row per Cardano transaction.
alter table deposits add column if not exists applied_usd numeric;
create unique index if not exists deposits_tx_hash_key on deposits(tx_hash) where tx_hash is not null;
create index if not exists deposits_user_status_idx on deposits(user_id, status);

-- Sign-in rate limiting and cleanup.
alter table connect_challenges add column if not exists ip text;
create index if not exists connect_challenges_created_idx on connect_challenges(created_at);
create index if not exists connect_challenges_address_idx on connect_challenges(address, created_at);
create index if not exists connect_challenges_ip_idx on connect_challenges(ip, created_at);

-- Withdrawals: an audit trail of every quote and confirmation.
create table if not exists withdrawals (
  id          text primary key,                 -- Strike withdraw_id
  user_id     uuid not null references users(id) on delete cascade,
  usd_value   numeric not null,
  fee         numeric,
  status      text not null default 'quoted' check (status in ('quoted', 'confirmed', 'failed')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists withdrawals_user_idx on withdrawals(user_id, created_at desc);
alter table withdrawals enable row level security;

-- ── Second audit (2026-10-23). Idempotent. ──

-- Times are compared against the database clock (now()), never a server's local clock.
-- Close orders: when the last one was sent and how many times, so retries are timed on their own
-- (risk writes don't touch this) and stop after a cap with a note to close in Strike.
alter table plans add column if not exists close_sent_at  timestamptz;
alter table plans add column if not exists close_attempts int not null default 0;
-- One isolated-margin add in flight per plan, verified against the position before it counts:
-- {kind: 'buffer'|'topup', depositId?, amount, baseIso, at}. Strike's 200 only means "sequenced".
alter table plans add column if not exists margin_pending jsonb;
-- The client order id that opened the hedge (shown on the opening tracker).
alter table plans add column if not exists open_order_id text;
-- Costs plans close one month's share at most once per 30 days.
alter table plans add column if not exists last_month_reduce_at timestamptz;

-- Deposits: the hash of the transaction Locke built (blake2b-256 of its body), so a confirm can
-- only claim that transaction; and 'released' for money no longer reserved (its plan closed).
alter table deposits add column if not exists expected_tx_hash text;
alter table deposits drop constraint if exists deposits_status_check;
alter table deposits add constraint deposits_status_check
  check (status in ('built', 'submitted', 'credited', 'applied', 'failed', 'released'));

-- The exact challenge Strike issued, so sign-in can verify the wallet signed this message.
alter table connect_challenges add column if not exists message text;

-- Defense in depth: the app connects as a server role; the public API roles get nothing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
  end if;
end $$;

-- The scheduled sweep's last run (one row), for checking that monitoring is alive.
create table if not exists monitor_heartbeat (
  id      int primary key,
  at      timestamptz not null,
  result  jsonb
);
alter table monitor_heartbeat enable row level security;
