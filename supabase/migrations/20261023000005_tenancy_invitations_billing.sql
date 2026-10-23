-- Company registration, memberships, invitations, trial/subscription, platform owner tools.

-- ---------------------------------------------------------------------------
-- Self-service registration
-- ---------------------------------------------------------------------------
-- Creates a company for the signed-in user with a default crew and a 3-day trial.
-- Guards against accidental duplicates: a user who already administers a company must pass
-- p_allow_additional = true, and the same user cannot create two companies with the same name.
create or replace function public.create_company(
  p_name text, p_phone text default null, p_nip text default null, p_allow_additional boolean default false
) returns public.companies
language plpgsql security definer set search_path = '' as $$
declare
  v public.companies;
begin
  if auth.uid() is null then
    perform app.fail('auth', 'Zaloguj się, aby utworzyć konto firmy.');
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    perform app.fail('validation', 'Podaj nazwę firmy (min. 2 znaki).');
  end if;
  -- Serialise registrations of the same user (double clicks, two tabs).
  perform pg_advisory_xact_lock(hashtextextended('create_company:' || auth.uid()::text, 0));
  if exists (
    select 1 from public.companies c
    where c.created_by = auth.uid() and lower(trim(c.name)) = lower(trim(p_name))
  ) then
    perform app.fail('duplicate_company', 'Masz już firmę o tej nazwie. Wybierz ją z listy firm zamiast tworzyć nową.');
  end if;
  if not coalesce(p_allow_additional, false) and exists (
    select 1 from public.company_members m where m.user_id = auth.uid() and m.role = 'admin' and m.active
  ) then
    perform app.fail('already_admin', 'Masz już konto firmy w Flowmont. Aby utworzyć kolejną firmę, potwierdź to w formularzu.');
  end if;

  insert into public.companies (name, phone, nip, created_by, email)
  values (trim(p_name), app.clean_text(p_phone), app.clean_text(p_nip), auth.uid(),
          (select email from public.profiles where id = auth.uid()))
  returning * into v;
  insert into public.company_members (company_id, user_id, role) values (v.id, auth.uid(), 'admin');
  insert into public.crews (company_id, name, is_default) values (v.id, 'Ekipa 1', true);
  insert into public.subscriptions (company_id, status) values (v.id, 'trialing');
  perform app.audit(v.id, 'company.created', 'company', v.id::text, jsonb_build_object('name', v.name));
  return v;
end $$;

-- Companies visible to the current user with their role and access level (drives the
-- company switcher and routing after sign-in).
create or replace function public.my_companies()
returns table (
  company_id uuid, name text, role public.member_role, access_level text, is_demo boolean,
  trial_ends_at timestamptz, subscription_status public.subscription_status, store_ids uuid[], crew_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, m.role, app.access_level(c.id), c.is_demo, c.trial_ends_at,
         coalesce(s.status, 'trialing'),
         coalesce((select array_agg(sm.store_id) from public.store_members sm join public.stores st on st.id = sm.store_id
                   where sm.user_id = auth.uid() and sm.company_id = c.id and st.active), '{}'),
         coalesce((select array_agg(cm.crew_id) from public.crew_members cm
                   where cm.user_id = auth.uid() and cm.company_id = c.id), '{}')
  from public.company_members m
  join public.companies c on c.id = m.company_id
  left join public.subscriptions s on s.company_id = c.id
  where m.user_id = auth.uid() and m.active
  order by c.is_demo, c.name
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create or replace function public.company_users(p_company_id uuid)
returns table (
  user_id uuid, email text, full_name text, phone text, role public.member_role, active boolean,
  store_names text[], crew_names text[], joined_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_admin(p_company_id);
  return query
  select m.user_id, p.email, p.full_name, p.phone, m.role, m.active,
    coalesce((select array_agg(s.name order by s.name) from public.store_members sm join public.stores s on s.id = sm.store_id
              where sm.user_id = m.user_id and sm.company_id = p_company_id), '{}'),
    coalesce((select array_agg(c.name order by c.name) from public.crew_members cm join public.crews c on c.id = cm.crew_id
              where cm.user_id = m.user_id and cm.company_id = p_company_id), '{}'),
    m.created_at
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
  order by m.active desc, m.role, p.email;
end $$;

-- Deactivates/reactivates a member. History (jobs, activity) is preserved.
create or replace function public.set_member_active(p_company_id uuid, p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin(p_company_id);
  perform app.assert_can_write(p_company_id);
  if not p_active and p_user_id = auth.uid() then
    perform app.fail('validation', 'Nie możesz dezaktywować własnego konta.');
  end if;
  if not p_active and (select role from public.company_members where company_id = p_company_id and user_id = p_user_id) = 'admin'
     and (select count(*) from public.company_members where company_id = p_company_id and role = 'admin' and active) <= 1 then
    perform app.fail('validation', 'Firma musi mieć co najmniej jednego aktywnego administratora.');
  end if;
  update public.company_members set active = p_active where company_id = p_company_id and user_id = p_user_id;
  if not found then
    perform app.fail('not_found', 'Nie znaleziono użytkownika.');
  end if;
  perform app.audit(p_company_id, case when p_active then 'member.activated' else 'member.deactivated' end, 'user', p_user_id::text);
end $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create or replace function app.hash_token(p_token text) returns text
language sql immutable as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

-- Creates an invitation and queues the invitation e-mail. Returns the one-time link so the
-- administrator can also copy it manually. Only the token hash is stored.
create or replace function public.create_invitation(
  p_company_id uuid, p_email text, p_role public.member_role, p_store_id uuid default null, p_crew_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_inv public.invitations;
  v_company text;
  v_email text := lower(trim(p_email));
  v_link text;
  v_role_label text;
begin
  perform app.require_admin(p_company_id);
  perform app.assert_can_write(p_company_id);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform app.fail('validation', 'Podaj poprawny adres e-mail.');
  end if;
  if p_role = 'store_user' and not exists (select 1 from public.stores where id = p_store_id and company_id = p_company_id) then
    perform app.fail('validation', 'Wybierz sklep, do którego zapraszasz użytkownika.');
  end if;
  if p_role = 'crew_member' and not exists (select 1 from public.crews where id = p_crew_id and company_id = p_company_id) then
    perform app.fail('validation', 'Wybierz ekipę, do której zapraszasz użytkownika.');
  end if;
  -- Revoke older open invitations for the same e-mail and target.
  update public.invitations set revoked_at = now()
  where company_id = p_company_id and lower(email) = v_email and accepted_at is null and revoked_at is null;

  insert into public.invitations (company_id, email, role, store_id, crew_id, token_hash, invited_by)
  values (p_company_id, v_email, p_role,
          case when p_role = 'store_user' then p_store_id end,
          case when p_role = 'crew_member' then p_crew_id end,
          app.hash_token(v_token), auth.uid())
  returning * into v_inv;

  select name into v_company from public.companies where id = p_company_id;
  v_role_label := case p_role when 'admin' then 'administrator' when 'store_user' then 'sklep partnerski' else 'członek ekipy' end;
  v_link := coalesce(rtrim(app.setting('app_url'), '/'), '') || '/invite/' || v_token;
  perform app.enqueue(
    p_company_id, 'invitation', 'email', v_email, v_email,
    format('Zaproszenie do Flowmont – %s', v_company),
    format(E'Firma %s zaprasza Cię do Flowmont (rola: %s).\n\nAby dołączyć, otwórz link i zaloguj się tym adresem e-mail (%s):\n%s\n\nLink jest ważny 7 dni.',
           v_company, v_role_label, v_email, v_link),
    'invitation:' || v_inv.id::text
  );
  perform app.audit(p_company_id, 'invitation.created', 'invitation', v_inv.id::text, jsonb_build_object('email', v_email, 'role', p_role));
  return jsonb_build_object('invitation_id', v_inv.id, 'token', v_token, 'path', '/invite/' || v_token, 'expires_at', v_inv.expires_at);
end $$;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.invitations;
begin
  select * into v from public.invitations where id = p_invitation_id;
  if v.id is null or not app.is_admin(v.company_id) then
    perform app.fail('not_found', 'Nie znaleziono zaproszenia.');
  end if;
  update public.invitations set revoked_at = now() where id = v.id and accepted_at is null;
end $$;

-- Public, minimal invitation lookup (works before sign-in). Reveals no data beyond the
-- company name, role and a masked e-mail.
create or replace function public.get_invitation(p_token text)
returns table (status text, company_name text, role public.member_role, email_hint text, store_name text, email_matches boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.invitations;
  v_user_email text;
begin
  select * into v from public.invitations where token_hash = app.hash_token(coalesce(p_token, ''));
  if v.id is null then
    return query select 'invalid'::text, null::text, null::public.member_role, null::text, null::text, null::boolean;
    return;
  end if;
  select lower(email) into v_user_email from auth.users where id = auth.uid();
  return query select
    case
      when v.revoked_at is not null then 'revoked'
      when v.accepted_at is not null then 'accepted'
      when v.expires_at < now() then 'expired'
      else 'valid'
    end,
    (select name from public.companies where id = v.company_id),
    v.role,
    regexp_replace(v.email, '^(.)[^@]*(@.*)$', '\1***\2'),
    (select name from public.stores where id = v.store_id),
    case when v_user_email is null then null else v_user_email = lower(v.email) end;
end $$;

-- Accepts an invitation for the signed-in account. The account e-mail must match the invited
-- address, so a link opened while signed in with another account cannot attach the wrong user.
create or replace function public.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.invitations;
  v_user_email text;
  v_existing public.company_members;
begin
  if auth.uid() is null then
    perform app.fail('auth', 'Zaloguj się, aby przyjąć zaproszenie.');
  end if;
  select * into v from public.invitations where token_hash = app.hash_token(coalesce(p_token, '')) for update;
  if v.id is null then
    perform app.fail('invitation_invalid', 'Ten link zaproszenia jest nieprawidłowy.');
  end if;
  if v.revoked_at is not null then
    perform app.fail('invitation_revoked', 'To zaproszenie zostało wycofane. Poproś administratora o nowe.');
  end if;
  if v.accepted_at is not null then
    if v.accepted_by = auth.uid() then
      return jsonb_build_object('company_id', v.company_id, 'role', v.role, 'already_accepted', true);
    end if;
    perform app.fail('invitation_used', 'To zaproszenie zostało już wykorzystane.');
  end if;
  if v.expires_at < now() then
    perform app.fail('invitation_expired', 'To zaproszenie wygasło. Poproś administratora o wysłanie nowego.');
  end if;
  select lower(email) into v_user_email from auth.users where id = auth.uid();
  if v_user_email is distinct from lower(v.email) then
    perform app.fail('invitation_email_mismatch',
      'To zaproszenie jest przeznaczone dla innego adresu e-mail. Wyloguj się i zaloguj kontem, na które przyszło zaproszenie.');
  end if;

  select * into v_existing from public.company_members where company_id = v.company_id and user_id = auth.uid();
  if v_existing.user_id is null then
    insert into public.company_members (company_id, user_id, role) values (v.company_id, auth.uid(), v.role);
  elsif v_existing.role <> v.role then
    if v_existing.role = 'admin' then
      perform app.fail('validation', 'Jesteś już administratorem tej firmy.');
    end if;
    perform app.fail('validation', 'Masz już w tej firmie konto z inną rolą. Poproś administratora o zmianę uprawnień.');
  else
    update public.company_members set active = true where company_id = v.company_id and user_id = auth.uid();
  end if;
  if v.role = 'store_user' then
    insert into public.store_members (store_id, company_id, user_id) values (v.store_id, v.company_id, auth.uid())
    on conflict do nothing;
  elsif v.role = 'crew_member' then
    insert into public.crew_members (crew_id, company_id, user_id) values (v.crew_id, v.company_id, auth.uid())
    on conflict do nothing;
  end if;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v.id;
  perform app.audit(v.company_id, 'invitation.accepted', 'invitation', v.id::text);
  return jsonb_build_object('company_id', v.company_id, 'role', v.role, 'already_accepted', false);
end $$;

-- Invitations addressed to the signed-in user's e-mail (shown after sign-in so the user does
-- not accidentally create a duplicate company instead of joining).
create or replace function public.my_pending_invitations()
returns table (company_name text, role public.member_role, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.name, i.role, i.expires_at
  from public.invitations i join public.companies c on c.id = i.company_id
  where lower(i.email) = (select lower(email) from auth.users where id = auth.uid())
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

-- ---------------------------------------------------------------------------
-- Access info for banners (any member)
-- ---------------------------------------------------------------------------
create or replace function public.company_access(p_company_id uuid)
returns table (access_level text, trial_started_at timestamptz, trial_ends_at timestamptz,
               subscription_status public.subscription_status, current_period_end timestamptz, plan_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_member(p_company_id) then
    perform app.fail('not_found', 'Brak dostępu.');
  end if;
  return query
  select app.access_level(c.id), c.trial_started_at, c.trial_ends_at, coalesce(s.status, 'trialing'), s.current_period_end, s.plan_id
  from public.companies c left join public.subscriptions s on s.company_id = c.id
  where c.id = p_company_id;
end $$;

-- ---------------------------------------------------------------------------
-- Billing (called by the billing webhook Edge Function with the service role)
-- ---------------------------------------------------------------------------
create or replace function public.apply_billing_event(
  p_provider text, p_event_id text, p_event_type text, p_company_id uuid, p_payload jsonb,
  p_status public.subscription_status default null, p_plan_id text default null,
  p_customer_id text default null, p_subscription_id text default null,
  p_period_end timestamptz default null, p_cancel_at_period_end boolean default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- Idempotency: each provider event is applied once.
  insert into public.billing_events (provider, event_id, event_type, company_id, payload)
  values (p_provider, p_event_id, p_event_type, p_company_id, p_payload)
  on conflict do nothing;
  if not found then
    return false;
  end if;
  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then
    return true;
  end if;
  insert into public.subscriptions (company_id, status) values (p_company_id, 'trialing') on conflict do nothing;
  update public.subscriptions set
    status = coalesce(p_status, status),
    plan_id = coalesce(p_plan_id, plan_id),
    provider = p_provider,
    provider_customer_id = coalesce(p_customer_id, provider_customer_id),
    provider_subscription_id = coalesce(p_subscription_id, provider_subscription_id),
    current_period_end = coalesce(p_period_end, current_period_end),
    cancel_at_period_end = coalesce(p_cancel_at_period_end, cancel_at_period_end),
    updated_at = now()
  where company_id = p_company_id;
  insert into public.audit_events (company_id, action, entity, entity_id, details)
  values (p_company_id, 'billing.' || p_event_type, 'subscription', p_company_id::text,
          jsonb_build_object('status', p_status, 'event_id', p_event_id));
  return true;
end $$;

-- Marks expired trials (status bookkeeping only; access is computed by app.access_level).
create or replace function public.expire_trials() returns int
language sql security definer set search_path = '' as $$
  with upd as (
    update public.subscriptions s set status = 'expired', updated_at = now()
    from public.companies c
    where c.id = s.company_id and s.status = 'trialing' and c.trial_ends_at < now()
    returning 1
  ) select count(*)::int from upd
$$;

-- ---------------------------------------------------------------------------
-- Platform owner (operational account data only, no job details or files)
-- ---------------------------------------------------------------------------
create or replace function public.platform_companies()
returns table (
  company_id uuid, name text, status public.company_status, is_demo boolean, created_at timestamptz,
  trial_ends_at timestamptz, subscription_status public.subscription_status, access_level text,
  admin_emails text[], member_count int, store_count int, job_count int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_owner() then
    perform app.fail('forbidden', 'Brak uprawnień.');
  end if;
  return query
  select c.id, c.name, c.status, c.is_demo, c.created_at, c.trial_ends_at, coalesce(s.status, 'trialing'),
    app.access_level(c.id),
    coalesce((select array_agg(p.email) from public.company_members m join public.profiles p on p.id = m.user_id
              where m.company_id = c.id and m.role = 'admin' and m.active), '{}'),
    (select count(*) from public.company_members m where m.company_id = c.id and m.active)::int,
    (select count(*) from public.stores st where st.company_id = c.id and st.active)::int,
    (select count(*) from public.jobs j where j.company_id = c.id)::int
  from public.companies c left join public.subscriptions s on s.company_id = c.id
  order by c.created_at desc;
end $$;

create or replace function public.platform_set_company_status(p_company_id uuid, p_status public.company_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_owner() then
    perform app.fail('forbidden', 'Brak uprawnień.');
  end if;
  update public.companies set status = p_status where id = p_company_id;
  insert into public.audit_events (company_id, actor_id, action, entity, entity_id)
  values (p_company_id, auth.uid(), 'platform.company_' || p_status::text, 'company', p_company_id::text);
end $$;

create or replace function public.platform_extend_trial(p_company_id uuid, p_days int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_owner() then
    perform app.fail('forbidden', 'Brak uprawnień.');
  end if;
  if p_days not between 1 and 60 then
    perform app.fail('validation', 'Podaj liczbę dni od 1 do 60.');
  end if;
  update public.companies set trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => p_days) where id = p_company_id;
  update public.subscriptions set status = 'trialing' where company_id = p_company_id and status = 'expired';
  insert into public.audit_events (company_id, actor_id, action, entity, entity_id, details)
  values (p_company_id, auth.uid(), 'platform.trial_extended', 'company', p_company_id::text, jsonb_build_object('days', p_days));
end $$;
