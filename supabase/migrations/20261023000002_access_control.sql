-- Access-control helpers and row level security.
-- The client never proves tenancy by sending a company_id: every policy derives access
-- from auth.uid() and the membership tables.

-- ---------------------------------------------------------------------------
-- Error helper: raises a Polish user-facing message with a stable machine code in HINT.
-- ---------------------------------------------------------------------------
create or replace function app.fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end $$;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_platform_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_owner from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function app.member_role(p_company uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.company_members m
  where m.company_id = p_company and m.user_id = auth.uid() and m.active
$$;

create or replace function app.is_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active and m.role = 'admin'
  )
$$;

create or replace function app.is_member(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
  )
$$;

-- Stores the current user belongs to (only through an active store_user membership).
create or replace function app.user_store_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select sm.store_id
  from public.store_members sm
  join public.company_members m on m.company_id = sm.company_id and m.user_id = sm.user_id
  join public.stores s on s.id = sm.store_id
  where sm.user_id = auth.uid() and m.active and m.role = 'store_user' and s.active
$$;

create or replace function app.user_crew_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cm.crew_id
  from public.crew_members cm
  join public.company_members m on m.company_id = cm.company_id and m.user_id = cm.user_id
  where cm.user_id = auth.uid() and m.active and m.role in ('crew_member', 'admin')
$$;

-- ---------------------------------------------------------------------------
-- Entitlement
--   full       trial running, or subscription active / past_due (grace while the provider retries)
--   read_only  trial expired without subscription, subscription cancelled or expired
--   suspended  access suspended by the platform owner
-- ---------------------------------------------------------------------------
create or replace function app.access_level(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when c.id is null then 'none'
    when c.status = 'suspended' then 'suspended'
    when s.status in ('active', 'past_due') then 'full'
    when c.trial_ends_at > now() and coalesce(s.status, 'trialing') = 'trialing' then 'full'
    else 'read_only'
  end
  from (select 1) one
  left join public.companies c on c.id = p_company
  left join public.subscriptions s on s.company_id = c.id
$$;

create or replace function app.can_write(p_company uuid) returns boolean
language sql stable as $$ select app.access_level(p_company) = 'full' $$;

create or replace function app.assert_can_write(p_company uuid) returns void
language plpgsql stable as $$
declare
  v_level text := app.access_level(p_company);
begin
  if v_level = 'suspended' then
    perform app.fail('company_suspended', 'Dostęp do konta firmy został zawieszony. Skontaktuj się z obsługą Flowmont.');
  elsif v_level <> 'full' then
    perform app.fail('read_only', 'Okres próbny lub subskrypcja wygasły. Dane są dostępne tylko do odczytu – przejdź do zakładki Subskrypcja, aby wznowić dostęp.');
  end if;
end $$;

-- Members can read company data unless the company is suspended (administrators keep
-- read access so they can see billing and contact support).
create or replace function app.can_read(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
      and (c.status = 'active' or m.role = 'admin')
  )
$$;

create or replace function app.can_view_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job
      and app.can_read(j.company_id)
      and (
        app.is_admin(j.company_id)
        or j.store_id in (select app.user_store_ids())
        or (j.crew_id is not null and j.crew_id in (select app.user_crew_ids()))
      )
  )
$$;

-- Job details (customer data, measurements) may be edited by admins at any time and by
-- store users while their request is still pending.
create or replace function app.can_edit_job_details(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job
      and app.can_write(j.company_id)
      and (
        (app.is_admin(j.company_id) and j.status not in ('completed', 'rejected', 'cancelled'))
        or (j.status = 'pending' and j.store_id in (select app.user_store_ids()))
      )
  )
$$;

-- Files may be added by admins, the job's store and the assigned crew while the job is active.
create or replace function app.can_add_files(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job
      and app.can_write(j.company_id)
      and j.status in ('pending', 'confirmed', 'in_progress')
      and (
        app.is_admin(j.company_id)
        or j.store_id in (select app.user_store_ids())
        or (j.crew_id is not null and j.crew_id in (select app.user_crew_ids()))
      )
  )
$$;

create or replace function app.job_company(p_job uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.jobs where id = p_job
$$;

create or replace function app.actor_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.full_name, ''), p.email, '') from public.profiles p where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Profile bootstrap from auth.users
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function app.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function app.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.company_counters enable row level security;
alter table public.jobs enable row level security;
alter table public.job_measurements enable row level security;
alter table public.job_attachments enable row level security;
alter table public.job_notes enable row level security;
alter table public.job_activity enable row level security;
alter table public.plan_positions enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.invitations enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_row_errors enable row level security;
alter table public.billing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.audit_events enable row level security;

-- Start from zero privileges for client roles; grant only what each table needs.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- profiles
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.company_members other
    where other.user_id = profiles.id and app.is_admin(other.company_id)
  )
  or exists (
    select 1 from public.crew_members cm
    where cm.user_id = profiles.id and app.is_member(cm.company_id)
      and app.member_role(cm.company_id) in ('admin', 'crew_member')
  )
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- companies
grant select on public.companies to authenticated;
grant update (name, nip, email, phone, address, notification_email, notification_phone) on public.companies to authenticated;
create policy companies_select on public.companies for select to authenticated using (app.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (app.is_admin(id) and app.can_write(id)) with check (app.is_admin(id) and app.can_write(id));

-- company_members (changes go through RPCs)
grant select on public.company_members to authenticated;
create policy company_members_select on public.company_members for select to authenticated using (
  user_id = auth.uid() or app.is_admin(company_id)
);

-- stores
grant select on public.stores to authenticated;
grant insert (company_id, name, nip, email, phone, street, postal_code, city, contact_person, notes, active) on public.stores to authenticated;
grant update (name, nip, email, phone, street, postal_code, city, contact_person, notes, active) on public.stores to authenticated;
create policy stores_select on public.stores for select to authenticated using (
  app.can_read(company_id) and (
    app.member_role(company_id) in ('admin', 'crew_member')
    or id in (select app.user_store_ids())
  )
);
create policy stores_insert on public.stores for insert to authenticated
  with check (app.is_admin(company_id) and app.can_write(company_id));
create policy stores_update on public.stores for update to authenticated
  using (app.is_admin(company_id) and app.can_write(company_id))
  with check (app.is_admin(company_id) and app.can_write(company_id));

-- store_members
grant select, delete on public.store_members to authenticated;
create policy store_members_select on public.store_members for select to authenticated using (
  user_id = auth.uid() or app.is_admin(company_id)
);
create policy store_members_delete on public.store_members for delete to authenticated
  using (app.is_admin(company_id) and app.can_write(company_id));

-- crews
grant select on public.crews to authenticated;
grant insert (company_id, name, color, active) on public.crews to authenticated;
grant update (name, color, active) on public.crews to authenticated;
create policy crews_select on public.crews for select to authenticated using (app.can_read(company_id));
create policy crews_insert on public.crews for insert to authenticated
  with check (app.is_admin(company_id) and app.can_write(company_id));
create policy crews_update on public.crews for update to authenticated
  using (app.is_admin(company_id) and app.can_write(company_id))
  with check (app.is_admin(company_id) and app.can_write(company_id));

-- crew_members
grant select, insert, delete on public.crew_members to authenticated;
create policy crew_members_select on public.crew_members for select to authenticated using (
  user_id = auth.uid() or app.is_admin(company_id)
);
create policy crew_members_insert on public.crew_members for insert to authenticated with check (
  app.is_admin(company_id) and app.can_write(company_id)
  and exists (
    select 1 from public.company_members m
    where m.company_id = crew_members.company_id and m.user_id = crew_members.user_id
      and m.active and m.role in ('crew_member', 'admin')
  )
);
create policy crew_members_delete on public.crew_members for delete to authenticated
  using (app.is_admin(company_id) and app.can_write(company_id));

-- jobs: read through visibility rules, every write goes through RPCs with business rules.
grant select on public.jobs to authenticated;
create policy jobs_select on public.jobs for select to authenticated using (
  app.can_read(company_id) and (
    app.is_admin(company_id)
    or store_id in (select app.user_store_ids())
    or (crew_id is not null and crew_id in (select app.user_crew_ids()))
  )
);

-- job_measurements
grant select on public.job_measurements to authenticated;
grant insert (job_id, company_id, label, width, height, unit, quantity, notes, position) on public.job_measurements to authenticated;
grant update (label, width, height, unit, quantity, notes, position) on public.job_measurements to authenticated;
grant delete on public.job_measurements to authenticated;
create policy job_measurements_select on public.job_measurements for select to authenticated using (app.can_view_job(job_id));
create policy job_measurements_insert on public.job_measurements for insert to authenticated
  with check (app.can_edit_job_details(job_id) and company_id = app.job_company(job_id));
create policy job_measurements_update on public.job_measurements for update to authenticated
  using (app.can_edit_job_details(job_id)) with check (app.can_edit_job_details(job_id));
create policy job_measurements_delete on public.job_measurements for delete to authenticated
  using (app.can_edit_job_details(job_id));

-- job_attachments
grant select on public.job_attachments to authenticated;
grant insert (job_id, company_id, storage_path, file_name, mime_type, size_bytes, kind, uploaded_by) on public.job_attachments to authenticated;
grant delete on public.job_attachments to authenticated;
create policy job_attachments_select on public.job_attachments for select to authenticated using (app.can_view_job(job_id));
create policy job_attachments_insert on public.job_attachments for insert to authenticated with check (
  app.can_add_files(job_id)
  and company_id = app.job_company(job_id)
  and uploaded_by = auth.uid()
  and storage_path like (company_id::text || '/' || job_id::text || '/%')
);
create policy job_attachments_delete on public.job_attachments for delete to authenticated using (
  app.can_write(company_id) and (app.is_admin(company_id) or (uploaded_by = auth.uid() and app.can_add_files(job_id)))
);

-- job_notes
grant select on public.job_notes to authenticated;
grant insert (job_id, company_id, is_internal, body) on public.job_notes to authenticated;
create policy job_notes_select on public.job_notes for select to authenticated using (
  app.can_view_job(job_id) and (not is_internal or app.is_admin(company_id))
);
create policy job_notes_insert on public.job_notes for insert to authenticated with check (
  app.can_view_job(job_id)
  and company_id = app.job_company(job_id)
  and app.can_write(company_id)
  and (not is_internal or app.is_admin(company_id))
);

create or replace function app.job_notes_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := auth.uid();
  new.author_name := coalesce(app.actor_name(), '');
  return new;
end $$;
create trigger job_notes_defaults before insert on public.job_notes
  for each row execute function app.job_notes_defaults();

-- job_activity (written by RPCs only)
grant select on public.job_activity to authenticated;
create policy job_activity_select on public.job_activity for select to authenticated using (
  app.can_view_job(job_id) and (not is_internal or app.is_admin(company_id))
);

-- plan_positions
grant select on public.plan_positions to authenticated;
create policy plan_positions_select on public.plan_positions for select to authenticated using (
  app.can_read(company_id) and app.member_role(company_id) in ('admin', 'crew_member')
);

-- availability_blocks (reasons may be internal; stores see availability through get_availability)
grant select, delete on public.availability_blocks to authenticated;
create policy availability_blocks_select on public.availability_blocks for select to authenticated using (
  app.can_read(company_id) and app.member_role(company_id) in ('admin', 'crew_member')
);
create policy availability_blocks_delete on public.availability_blocks for delete to authenticated
  using (app.is_admin(company_id) and app.can_write(company_id));

-- invitations
grant select on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated using (app.is_admin(company_id));

-- notification_preferences
grant select, insert, update, delete on public.notification_preferences to authenticated;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid() and app.is_member(company_id))
  with check (user_id = auth.uid() and app.is_member(company_id));

-- announcements & outbox: administrators only
grant select on public.announcements, public.announcement_recipients, public.notification_outbox to authenticated;
create policy announcements_select on public.announcements for select to authenticated using (app.is_admin(company_id));
create policy announcement_recipients_select on public.announcement_recipients for select to authenticated using (app.is_admin(company_id));
create policy notification_outbox_select on public.notification_outbox for select to authenticated using (app.is_admin(company_id));

-- imports
grant select on public.import_runs, public.import_row_errors to authenticated;
create policy import_runs_select on public.import_runs for select to authenticated using (app.is_admin(company_id));
create policy import_row_errors_select on public.import_row_errors for select to authenticated using (app.is_admin(company_id));

-- billing
grant select on public.billing_plans to authenticated;
create policy billing_plans_select on public.billing_plans for select to authenticated using (active);
grant select on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions for select to authenticated using (app.is_admin(company_id));
-- billing_events and company_counters: no client access at all (RLS enabled, no policies).

-- audit
grant select on public.audit_events to authenticated;
create policy audit_events_select on public.audit_events for select to authenticated using (
  company_id is not null and app.is_admin(company_id)
);

-- Service role keeps full access (used only by Edge Functions on the server).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
