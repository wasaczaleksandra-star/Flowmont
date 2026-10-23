-- Notification outbox, Polish templates, availability announcements.
-- Messages are rendered at enqueue time so administrators can preview exactly what is sent.
-- Bodies contain minimal personal data: job reference, dates, city and store name only.

create table public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
grant all on public.app_settings to service_role;

create or replace function app.setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key
$$;

alter table public.stores add column notify_email boolean not null default true;
alter table public.stores add column notify_sms boolean not null default false;
grant insert (notify_email, notify_sms), update (notify_email, notify_sms) on public.stores to authenticated;

-- ---------------------------------------------------------------------------
-- Polish date formatting (independent of server locale)
-- ---------------------------------------------------------------------------
create or replace function app.pl_month_gen(p_month int) returns text
language sql immutable as $$
  select (array['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'])[p_month]
$$;

create or replace function app.pl_weekday(p date) returns text
language sql immutable as $$
  select (array['poniedziałek','wtorek','środa','czwartek','piątek','sobota','niedziela'])[extract(isodow from p)::int]
$$;

-- "czwartek, 12 listopada 2026"
create or replace function app.pl_date(p date) returns text
language sql immutable as $$
  select app.pl_weekday(p) || ', ' || extract(day from p)::int || ' ' || app.pl_month_gen(extract(month from p)::int) || ' ' || extract(year from p)::int
$$;

-- "12 listopada 2026", "12–14 listopada 2026", "30 listopada – 2 grudnia 2026"
create or replace function app.pl_range(p_start date, p_end date) returns text
language sql immutable as $$
  select case
    when p_end is null or p_end = p_start then
      extract(day from p_start)::int || ' ' || app.pl_month_gen(extract(month from p_start)::int) || ' ' || extract(year from p_start)::int
    when date_trunc('month', p_start) = date_trunc('month', p_end) then
      extract(day from p_start)::int || '–' || extract(day from p_end)::int || ' ' || app.pl_month_gen(extract(month from p_end)::int) || ' ' || extract(year from p_end)::int
    when extract(year from p_start) = extract(year from p_end) then
      extract(day from p_start)::int || ' ' || app.pl_month_gen(extract(month from p_start)::int) || ' – ' ||
      extract(day from p_end)::int || ' ' || app.pl_month_gen(extract(month from p_end)::int) || ' ' || extract(year from p_end)::int
    else
      extract(day from p_start)::int || ' ' || app.pl_month_gen(extract(month from p_start)::int) || ' ' || extract(year from p_start)::int || ' – ' ||
      extract(day from p_end)::int || ' ' || app.pl_month_gen(extract(month from p_end)::int) || ' ' || extract(year from p_end)::int
  end
$$;

-- ---------------------------------------------------------------------------
-- Recipients
-- ---------------------------------------------------------------------------
create or replace function app.pref_enabled(p_company uuid, p_user uuid, p_event text, p_channel public.notification_channel)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select case when p_channel = 'email' then np.email_enabled else np.sms_enabled end
     from public.notification_preferences np
     where np.company_id = p_company and np.user_id = p_user and np.event_type = p_event),
    p_channel = 'email'
  )
$$;

create or replace function app.admin_recipients(p_company uuid, p_event text)
returns table (channel public.notification_channel, recipient text, label text)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.channel, lower(r.recipient)) r.channel, r.recipient, r.label from (
    select 'email'::public.notification_channel as channel, p.email as recipient, coalesce(nullif(p.full_name, ''), p.email) as label
    from public.company_members m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.active and m.role = 'admin' and p.email <> ''
      and app.pref_enabled(p_company, p.id, p_event, 'email')
    union all
    select 'sms', p.phone, coalesce(nullif(p.full_name, ''), p.email)
    from public.company_members m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.active and m.role = 'admin' and p.phone is not null
      and app.pref_enabled(p_company, p.id, p_event, 'sms')
    union all
    select 'email', c.notification_email, 'Adres powiadomień firmy'
    from public.companies c where c.id = p_company and c.notification_email is not null
    union all
    select 'sms', c.notification_phone, 'Telefon powiadomień firmy'
    from public.companies c where c.id = p_company and c.notification_phone is not null
  ) r
  where nullif(trim(r.recipient), '') is not null
$$;

create or replace function app.store_recipients(p_store uuid, p_event text)
returns table (channel public.notification_channel, recipient text, label text)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.channel, lower(r.recipient)) r.channel, r.recipient, r.label from (
    select 'email'::public.notification_channel as channel, s.email as recipient, s.name as label
    from public.stores s where s.id = p_store and s.notify_email and s.email is not null
    union all
    select 'sms', s.phone, s.name
    from public.stores s where s.id = p_store and s.notify_sms and s.phone is not null
    union all
    select 'email', p.email, coalesce(nullif(p.full_name, ''), p.email)
    from public.store_members sm
    join public.company_members m on m.company_id = sm.company_id and m.user_id = sm.user_id
    join public.profiles p on p.id = sm.user_id
    where sm.store_id = p_store and m.active and p.email <> ''
      and app.pref_enabled(sm.company_id, p.id, p_event, 'email')
    union all
    select 'sms', p.phone, coalesce(nullif(p.full_name, ''), p.email)
    from public.store_members sm
    join public.company_members m on m.company_id = sm.company_id and m.user_id = sm.user_id
    join public.profiles p on p.id = sm.user_id
    where sm.store_id = p_store and m.active and p.phone is not null
      and app.pref_enabled(sm.company_id, p.id, p_event, 'sms')
  ) r
  where nullif(trim(r.recipient), '') is not null
$$;

create or replace function app.crew_recipients(p_crew uuid, p_event text)
returns table (channel public.notification_channel, recipient text, label text)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.channel, lower(r.recipient)) r.channel, r.recipient, r.label from (
    select 'email'::public.notification_channel as channel, p.email as recipient, coalesce(nullif(p.full_name, ''), p.email) as label
    from public.crew_members cm
    join public.company_members m on m.company_id = cm.company_id and m.user_id = cm.user_id
    join public.profiles p on p.id = cm.user_id
    where cm.crew_id = p_crew and m.active and p.email <> ''
      and app.pref_enabled(cm.company_id, p.id, p_event, 'email')
    union all
    select 'sms', p.phone, coalesce(nullif(p.full_name, ''), p.email)
    from public.crew_members cm
    join public.company_members m on m.company_id = cm.company_id and m.user_id = cm.user_id
    join public.profiles p on p.id = cm.user_id
    where cm.crew_id = p_crew and m.active and p.phone is not null
      and app.pref_enabled(cm.company_id, p.id, p_event, 'sms')
  ) r
  where nullif(trim(r.recipient), '') is not null
$$;

-- ---------------------------------------------------------------------------
-- Enqueue (idempotent: the same key is never queued twice)
-- ---------------------------------------------------------------------------
create or replace function app.enqueue(
  p_company uuid, p_event text, p_channel public.notification_channel, p_recipient text, p_label text,
  p_subject text, p_body text, p_key text, p_job uuid default null, p_announcement uuid default null
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notification_outbox
    (company_id, event_type, channel, recipient, recipient_label, subject, body, idempotency_key, job_id, announcement_id)
  values
    (p_company, p_event, p_channel, trim(p_recipient), p_label, p_subject, p_body, p_key, p_job, p_announcement)
  on conflict (idempotency_key) do nothing;
$$;

create or replace function app.link(p_path text) returns text
language sql stable as $$
  select case when app.setting('app_url') is null then '' else E'\n\n' || rtrim(app.setting('app_url'), '/') || p_path end
$$;

create or replace function app.notify_job_event(p_job uuid, p_event text, p_extra jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  v_store text;
  v_crew text;
  v_range text;
  v_subject text;
  v_body text;
  v_sms text;
  v_act bigint;
  r record;
  v_targets text[];
  v_old_crew uuid := nullif(p_extra ->> 'old_crew_id', '')::uuid;
begin
  select * into j from public.jobs where id = p_job;
  select name into v_store from public.stores where id = j.store_id;
  select name into v_crew from public.crews where id = j.crew_id;
  select max(id) into v_act from public.job_activity where job_id = p_job;
  v_range := app.pl_range(coalesce(j.confirmed_start, j.requested_start), coalesce(j.confirmed_end, j.requested_end));

  case p_event
    when 'job_requested' then
      v_targets := array['admins'];
      v_subject := format('Nowe zgłoszenie montażu %s', j.reference);
      v_body := format('Sklep %s zgłosił montaż %s (%s), proponowany termin: %s. Potwierdź lub odrzuć zgłoszenie w Flowmont.', v_store, j.reference, j.city, v_range);
    when 'job_withdrawn' then
      v_targets := array['admins'];
      v_subject := format('Zgłoszenie %s zostało wycofane', j.reference);
      v_body := format('Sklep %s wycofał zgłoszenie %s (%s, %s).', v_store, j.reference, j.city, v_range);
    when 'job_confirmed' then
      v_targets := array['store', 'crew'];
      v_subject := format('Montaż %s potwierdzony: %s', j.reference, v_range);
      v_body := format('Montaż %s (%s) został potwierdzony na %s. Ekipa: %s.', j.reference, j.city, v_range, v_crew);
    when 'job_rejected' then
      v_targets := array['store'];
      v_subject := format('Zgłoszenie %s zostało odrzucone', j.reference);
      v_body := format('Zgłoszenie montażu %s (%s, %s) zostało odrzucone.%s Szczegóły znajdziesz w Flowmont.', j.reference, j.city, v_range,
        case when j.rejection_reason is not null then ' Powód: ' || j.rejection_reason || '.' else '' end);
    when 'job_cancelled' then
      v_targets := array['store', 'crew'];
      v_subject := format('Montaż %s został anulowany', j.reference);
      v_body := format('Montaż %s (%s, %s) został anulowany.%s', j.reference, j.city, v_range,
        case when j.cancellation_reason is not null then ' Powód: ' || j.cancellation_reason || '.' else '' end);
    when 'job_rescheduled' then
      v_targets := array['store', 'crew', 'old_crew'];
      v_subject := format('Zmiana terminu montażu %s', j.reference);
      v_body := format('Termin montażu %s (%s) został zmieniony z %s na %s. Ekipa: %s.', j.reference, j.city,
        app.pl_range((p_extra ->> 'old_start')::date, (p_extra ->> 'old_end')::date), v_range, v_crew);
    when 'job_completed' then
      v_targets := array['store'];
      v_subject := format('Montaż %s zakończony', j.reference);
      v_body := format('Montaż %s (%s) został zakończony.', j.reference, j.city);
    else
      return;
  end case;

  v_sms := 'Flowmont: ' || v_body;
  v_body := v_body || app.link('/jobs/' || j.id);

  for r in
    select 'admins' as target, a.* from app.admin_recipients(j.company_id, p_event) a where 'admins' = any(v_targets)
    union all
    select 'store', s.* from app.store_recipients(j.store_id, p_event) s where 'store' = any(v_targets)
    union all
    select 'crew', c.* from app.crew_recipients(j.crew_id, p_event) c where 'crew' = any(v_targets) and j.crew_id is not null
    union all
    select 'old_crew', c.* from app.crew_recipients(v_old_crew, p_event) c
      where 'old_crew' = any(v_targets) and v_old_crew is not null and v_old_crew is distinct from j.crew_id
  loop
    perform app.enqueue(
      j.company_id, p_event, r.channel, r.recipient, r.label,
      case when r.channel = 'email' then v_subject end,
      case when r.channel = 'email' then v_body else left(v_sms, 459) end,
      format('%s:%s:%s:%s:%s', p_event, j.id, coalesce(v_act, 0), r.channel, lower(r.recipient)),
      j.id
    );
  end loop;
end $$;

-- A previously occupied date range became free: tell administrators (no automatic store blast).
create or replace function app.notify_date_released(p_company uuid, p_job uuid, p_start date, p_end date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_ref text;
  v_act bigint;
  v_body text;
begin
  select reference into v_ref from public.jobs where id = p_job;
  select max(id) into v_act from public.job_activity where job_id = p_job;
  v_body := format('Zwolnił się termin montażu: %s (po zmianie zlecenia %s). Możesz poinformować sklepy partnerskie, wysyłając ogłoszenie o dostępności w Flowmont.', app.pl_range(p_start, p_end), v_ref);
  for r in select * from app.admin_recipients(p_company, 'date_released') loop
    perform app.enqueue(
      p_company, 'date_released', r.channel, r.recipient, r.label,
      case when r.channel = 'email' then 'Zwolnił się termin montażu' end,
      case when r.channel = 'email' then v_body || app.link('/announcements') else 'Flowmont: ' || v_body end,
      format('date_released:%s:%s:%s:%s', p_job, coalesce(v_act, 0), r.channel, lower(r.recipient)),
      p_job
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Availability announcements
-- ---------------------------------------------------------------------------
create or replace function public.create_announcement(
  p_company_id uuid, p_dates date[], p_store_ids uuid[], p_message text, p_send_email boolean, p_send_sms boolean
) returns public.announcements
language plpgsql security definer set search_path = '' as $$
declare
  v public.announcements;
  v_dates date[];
begin
  perform app.require_admin(p_company_id);
  perform app.assert_can_write(p_company_id);
  select array_agg(distinct d order by d) into v_dates from unnest(p_dates) d;
  if v_dates is null then
    perform app.fail('validation', 'Wybierz co najmniej jeden termin.');
  end if;
  if v_dates[1] < app.today_pl() then
    perform app.fail('validation', 'Nie można ogłaszać terminów z przeszłości.');
  end if;
  if not coalesce(p_send_email, false) and not coalesce(p_send_sms, false) then
    perform app.fail('validation', 'Wybierz kanał: e-mail, SMS lub oba.');
  end if;
  if length(trim(coalesce(p_message, ''))) < 5 then
    perform app.fail('validation', 'Wpisz treść ogłoszenia.');
  end if;
  insert into public.announcements (company_id, dates, message, send_email, send_sms, created_by)
  values (p_company_id, v_dates, trim(p_message), coalesce(p_send_email, false), coalesce(p_send_sms, false), auth.uid())
  returning * into v;

  insert into public.announcement_recipients (announcement_id, store_id, company_id)
  select v.id, s.id, s.company_id from public.stores s
  where s.company_id = p_company_id and s.active
    and (p_store_ids is null or s.id = any(p_store_ids));
  if not found then
    perform app.fail('validation', 'Wybierz co najmniej jeden aktywny sklep.');
  end if;
  return v;
end $$;

-- Recipient preview for an announcement (administrators only).
create or replace function public.preview_announcement(p_announcement_id uuid)
returns table (store_id uuid, store_name text, channel public.notification_channel, recipient text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.announcements;
begin
  select * into v from public.announcements where id = p_announcement_id;
  if v.id is null or not app.is_admin(v.company_id) then
    perform app.fail('not_found', 'Nie znaleziono ogłoszenia.');
  end if;
  return query
  select ar.store_id, s.name, r.channel, r.recipient
  from public.announcement_recipients ar
  join public.stores s on s.id = ar.store_id
  cross join lateral app.store_recipients(ar.store_id, 'announcement') r
  where ar.announcement_id = v.id
    and ((r.channel = 'email' and v.send_email) or (r.channel = 'sms' and v.send_sms))
  order by s.name, r.channel;
end $$;

-- Sends an announcement exactly once. A second call fails instead of messaging stores again.
create or replace function public.send_announcement(p_announcement_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v public.announcements;
  r record;
  v_count int := 0;
  v_body text;
begin
  select * into v from public.announcements where id = p_announcement_id for update;
  if v.id is null or not app.is_admin(v.company_id) then
    perform app.fail('not_found', 'Nie znaleziono ogłoszenia.');
  end if;
  perform app.assert_can_write(v.company_id);
  if v.sent_at is not null then
    perform app.fail('already_sent', 'To ogłoszenie zostało już wysłane.');
  end if;
  for r in select * from public.preview_announcement(p_announcement_id) loop
    v_body := case when r.channel = 'email' then v.message || app.link('/calendar') else 'Flowmont: ' || v.message end;
    perform app.enqueue(
      v.company_id, 'announcement', r.channel, r.recipient, r.store_name,
      case when r.channel = 'email' then 'Wolny termin montażu' end,
      v_body,
      format('announcement:%s:%s:%s', v.id, r.channel, lower(r.recipient)),
      null, v.id
    );
    v_count := v_count + 1;
  end loop;
  update public.announcements set sent_at = now() where id = v.id;
  perform app.audit(v.company_id, 'announcement.sent', 'announcement', v.id::text, jsonb_build_object('messages', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Outbox processing (service role only)
-- ---------------------------------------------------------------------------
-- Atomically claims due messages. FOR UPDATE SKIP LOCKED guarantees that two workers never
-- receive the same message. Messages stuck in 'sending' for 10 minutes are reclaimed.
create or replace function public.claim_outbox(p_limit int default 20) returns setof public.notification_outbox
language sql security definer set search_path = '' as $$
  update public.notification_outbox o
     set status = 'sending', attempts = o.attempts + 1, locked_at = now()
   where o.id in (
     select id from public.notification_outbox
     where (status = 'queued' and next_attempt_at <= now())
        or (status = 'sending' and locked_at < now() - interval '10 minutes')
     order by created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
   )
  returning o.*;
$$;

create or replace function public.finish_outbox(
  p_id uuid, p_result text, p_provider text default null, p_provider_message_id text default null, p_error text default null
) returns public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare
  v public.notification_outbox;
begin
  select * into v from public.notification_outbox where id = p_id for update;
  if v.id is null or v.status <> 'sending' then
    -- Already finished by another worker: never flip a final state.
    return v;
  end if;
  if p_result = 'sent' then
    update public.notification_outbox set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id,
      last_error = null, processed_at = now(), locked_at = null where id = p_id returning * into v;
  elsif p_result = 'mocked' then
    update public.notification_outbox set status = 'mocked', provider = p_provider, last_error = null,
      processed_at = now(), locked_at = null where id = p_id returning * into v;
  elsif v.attempts < v.max_attempts then
    update public.notification_outbox set status = 'queued', provider = p_provider, last_error = left(p_error, 1000),
      next_attempt_at = now() + make_interval(mins => power(2, v.attempts)::int), locked_at = null
      where id = p_id returning * into v;
  else
    update public.notification_outbox set status = 'failed', provider = p_provider, last_error = left(p_error, 1000),
      processed_at = now(), locked_at = null where id = p_id returning * into v;
  end if;
  return v;
end $$;

-- Administrators can re-queue failed messages after fixing configuration.
create or replace function public.retry_notification(p_id uuid) returns public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare
  v public.notification_outbox;
begin
  select * into v from public.notification_outbox where id = p_id for update;
  if v.id is null or not app.is_admin(v.company_id) then
    perform app.fail('not_found', 'Nie znaleziono wiadomości.');
  end if;
  if v.status <> 'failed' then
    perform app.fail('validation', 'Ponowić można tylko wiadomość, której wysyłka się nie powiodła.');
  end if;
  update public.notification_outbox
    set status = 'queued', next_attempt_at = now(), max_attempts = v.attempts + 3, processed_at = null
    where id = p_id returning * into v;
  return v;
end $$;
