-- Flowmont core schema
-- Conventions:
--   * Every tenant-owned table carries company_id (FK to companies) and has RLS enabled.
--   * All-day date ranges are stored as two DATE columns with an INCLUSIVE end date
--     (start_date = first installation day, end_date = last installation day).
--     Generated daterange columns use '[]' bounds, which Postgres canonicalises to [start, end+1).
--   * Timestamps are timestamptz (stored in UTC); presentation uses Europe/Warsaw.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'store_user', 'crew_member');
create type public.job_status as enum ('pending', 'confirmed', 'in_progress', 'completed', 'rejected', 'cancelled');
create type public.company_status as enum ('active', 'suspended');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');
create type public.notification_channel as enum ('email', 'sms');
-- 'mocked' = rendered and stored by the development adapter, never delivered to a real recipient.
create type public.delivery_status as enum ('queued', 'sending', 'sent', 'failed', 'mocked');
create type public.attachment_kind as enum ('photo', 'measurement_doc', 'other');

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  is_platform_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Companies (tenants)
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  nip text,
  email text,
  phone text,
  address text,
  timezone text not null default 'Europe/Warsaw',
  status public.company_status not null default 'active',
  is_demo boolean not null default false,
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '3 days'),
  -- Where administrator notifications go (in addition to admin users' own preferences).
  notification_email text,
  notification_phone text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_created_by_idx on public.companies (created_by);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);

-- ---------------------------------------------------------------------------
-- Partner stores
-- ---------------------------------------------------------------------------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  nip text,
  email text,
  phone text,
  street text,
  postal_code text,
  city text,
  contact_person text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index stores_company_idx on public.stores (company_id);
create unique index stores_company_name_uniq on public.stores (company_id, lower(trim(name)));

create table public.store_members (
  store_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id),
  foreign key (store_id, company_id) references public.stores (id, company_id) on delete cascade
);
create index store_members_user_idx on public.store_members (user_id);

-- ---------------------------------------------------------------------------
-- Crews
-- ---------------------------------------------------------------------------
create table public.crews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default '#2F8EE0',
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create index crews_company_idx on public.crews (company_id);
create unique index crews_one_default on public.crews (company_id) where is_default;

create table public.crew_members (
  crew_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (crew_id, user_id),
  foreign key (crew_id, company_id) references public.crews (id, company_id) on delete cascade
);
create index crew_members_user_idx on public.crew_members (user_id);

-- ---------------------------------------------------------------------------
-- Jobs (booking requests and installation jobs are the same record)
-- ---------------------------------------------------------------------------
create table public.company_counters (
  company_id uuid not null references public.companies (id) on delete cascade,
  year int not null,
  last_value int not null default 0,
  primary key (company_id, year)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  store_id uuid not null,
  reference text not null,
  status public.job_status not null default 'pending',
  customer_name text not null check (length(trim(customer_name)) between 1 and 160),
  customer_phone text,
  street text not null check (length(trim(street)) between 1 and 200),
  postal_code text not null check (postal_code ~ '^[0-9]{2}-[0-9]{3}$'),
  city text not null check (length(trim(city)) between 1 and 120),
  description text not null check (length(trim(description)) between 1 and 4000),
  estimated_duration text,
  access_instructions text,
  notes text,
  -- Requested by the store (inclusive end date).
  requested_start date not null,
  requested_end date not null,
  -- Confirmed by the administrator (inclusive end date). Null until confirmed.
  confirmed_start date,
  confirmed_end date,
  crew_id uuid,
  rejection_reason text,
  cancellation_reason text,
  external_ref text,
  import_run_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (company_id, reference),
  foreign key (store_id, company_id) references public.stores (id, company_id),
  foreign key (crew_id, company_id) references public.crews (id, company_id),
  check (requested_end >= requested_start),
  check (requested_end - requested_start < 60),
  check ((confirmed_start is null) = (confirmed_end is null)),
  check (confirmed_end is null or confirmed_end >= confirmed_start),
  check (confirmed_end is null or confirmed_end - confirmed_start < 60),
  -- Confirmed / in progress jobs always have a crew and dates.
  check (status not in ('confirmed', 'in_progress') or (crew_id is not null and confirmed_start is not null)),
  confirmed_span daterange generated always as (
    case when confirmed_start is null then null else daterange(confirmed_start, confirmed_end, '[]') end
  ) stored,
  requested_span daterange generated always as (daterange(requested_start, requested_end, '[]')) stored,
  -- A crew can never hold two overlapping active jobs. Enforced by the database, so it also
  -- covers concurrent approvals (the second transaction fails with exclusion_violation).
  constraint jobs_crew_no_overlap exclude using gist (
    crew_id with =,
    confirmed_span with &&
  ) where (status in ('confirmed', 'in_progress'))
);
create index jobs_company_status_idx on public.jobs (company_id, status);
create index jobs_store_idx on public.jobs (store_id);
create index jobs_crew_idx on public.jobs (crew_id);
create index jobs_confirmed_span_idx on public.jobs using gist (company_id, confirmed_span);
create index jobs_requested_span_idx on public.jobs using gist (company_id, requested_span);
create unique index jobs_external_ref_uniq on public.jobs (company_id, external_ref) where external_ref is not null;

create table public.job_measurements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 120),
  width numeric(10, 1) check (width is null or width > 0),
  height numeric(10, 1) check (height is null or height > 0),
  unit text not null default 'mm' check (unit in ('mm', 'cm', 'm')),
  quantity int not null default 1 check (quantity between 1 and 999),
  notes text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index job_measurements_job_idx on public.job_measurements (job_id);

create table public.job_attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  kind public.attachment_kind not null default 'photo',
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index job_attachments_job_idx on public.job_attachments (job_id);

-- Notes: shared notes are visible to everyone with access to the job,
-- internal notes only to company administrators.
create table public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  is_internal boolean not null default false,
  body text not null check (length(trim(body)) between 1 and 4000),
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now()
);
create index job_notes_job_idx on public.job_notes (job_id);

create table public.job_activity (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  is_internal boolean not null default false,
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index job_activity_job_idx on public.job_activity (job_id, created_at);

-- Manual ordering of the daily work plan ("Plan dnia").
create table public.plan_positions (
  company_id uuid not null references public.companies (id) on delete cascade,
  plan_date date not null,
  job_id uuid not null references public.jobs (id) on delete cascade,
  position int not null,
  primary key (plan_date, job_id)
);
create index plan_positions_company_idx on public.plan_positions (company_id, plan_date);

-- ---------------------------------------------------------------------------
-- Availability blocks (company-wide when crew_id is null)
-- ---------------------------------------------------------------------------
create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  crew_id uuid,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (crew_id, company_id) references public.crews (id, company_id) on delete cascade,
  check (end_date >= start_date),
  span daterange generated always as (daterange(start_date, end_date, '[]')) stored
);
create index availability_blocks_span_idx on public.availability_blocks using gist (company_id, span);

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  store_id uuid,
  crew_id uuid,
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (store_id, company_id) references public.stores (id, company_id) on delete cascade,
  foreign key (crew_id, company_id) references public.crews (id, company_id) on delete cascade,
  check (role <> 'store_user' or store_id is not null),
  check (role <> 'crew_member' or crew_id is not null)
);
create index invitations_company_idx on public.invitations (company_id);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  primary key (company_id, user_id, event_type)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  dates date[] not null check (cardinality(dates) between 1 and 31),
  message text not null check (length(trim(message)) between 5 and 600),
  send_email boolean not null default true,
  send_sms boolean not null default false,
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (send_email or send_sms)
);
create index announcements_company_idx on public.announcements (company_id);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  primary key (announcement_id, store_id)
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  event_type text not null,
  channel public.notification_channel not null,
  recipient text not null,
  recipient_label text,
  subject text,
  body text not null,
  idempotency_key text not null unique,
  status public.delivery_status not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  provider text,
  provider_message_id text,
  job_id uuid references public.jobs (id) on delete set null,
  announcement_id uuid references public.announcements (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index notification_outbox_queue_idx on public.notification_outbox (status, next_attempt_at);
create index notification_outbox_company_idx on public.notification_outbox (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('stores', 'jobs')),
  file_name text,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'discarded')),
  total_rows int not null default 0,
  valid_rows int not null default 0,
  invalid_rows int not null default 0,
  duplicate_rows int not null default 0,
  imported_rows int not null default 0,
  rows jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index import_runs_company_idx on public.import_runs (company_id, created_at desc);

create table public.import_row_errors (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  row_number int not null,
  field text,
  message text not null,
  is_duplicate boolean not null default false
);
create index import_row_errors_run_idx on public.import_row_errors (import_run_id);

alter table public.jobs add foreign key (import_run_id) references public.import_runs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
-- Plans are configured by the platform owner. No prices are hard-coded.
create table public.billing_plans (
  id text primary key,
  name text not null,
  price_label text,
  provider_price_id text,
  active boolean not null default true,
  sort int not null default 0
);

create table public.subscriptions (
  company_id uuid primary key references public.companies (id) on delete cascade,
  status public.subscription_status not null default 'trialing',
  plan_id text references public.billing_plans (id),
  provider text,
  provider_customer_id text,
  provider_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.billing_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  company_id uuid references public.companies (id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_company_idx on public.audit_events (company_id, created_at desc);

-- updated_at maintenance
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();
create trigger companies_touch before update on public.companies for each row execute function app.touch_updated_at();
create trigger stores_touch before update on public.stores for each row execute function app.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function app.touch_updated_at();
