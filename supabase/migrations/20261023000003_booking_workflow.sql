-- Booking workflow: requests, approval, scheduling, field work.
-- All state changes go through these SECURITY DEFINER functions, which re-check permissions,
-- entitlement and business rules on the server.

create or replace function app.today_pl() returns date
language sql stable as $$ select (now() at time zone 'Europe/Warsaw')::date $$;

create or replace function app.log_activity(
  p_job uuid, p_company uuid, p_action text, p_details jsonb default '{}'::jsonb, p_internal boolean default false
) returns void
language sql security definer set search_path = '' as $$
  insert into public.job_activity (job_id, company_id, action, details, is_internal, actor_id, actor_name)
  values (p_job, p_company, p_action, coalesce(p_details, '{}'::jsonb), p_internal, auth.uid(), coalesce(app.actor_name(), 'System'));
$$;

create or replace function app.audit(p_company uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_events (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function app.next_job_reference(p_company uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_year int := extract(year from app.today_pl())::int;
  v_value int;
begin
  insert into public.company_counters (company_id, year, last_value)
  values (p_company, v_year, 1)
  on conflict (company_id, year) do update set last_value = public.company_counters.last_value + 1
  returning last_value into v_value;
  return 'FM-' || v_year || '-' || lpad(v_value::text, 4, '0');
end $$;

-- Normalises Polish postal codes ("00950" -> "00-950").
create or replace function app.normalize_postal_code(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when trim(p) ~ '^[0-9]{2}-[0-9]{3}$' then trim(p)
    when regexp_replace(p, '\s', '', 'g') ~ '^[0-9]{5}$' then substr(regexp_replace(p, '\s', '', 'g'), 1, 2) || '-' || substr(regexp_replace(p, '\s', '', 'g'), 3, 3)
    else trim(p)
  end
$$;

create or replace function app.clean_text(p text) returns text
language sql immutable as $$ select nullif(trim(p), '') $$;

-- Validates and normalises a job payload. Raises a Polish message on the first problem.
create or replace function app.validate_job_payload(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  v jsonb := '{}'::jsonb;
  v_start date;
  v_end date;
  v_phone text;
  v_postal text;
begin
  if app.clean_text(p ->> 'customer_name') is null then
    perform app.fail('validation', 'Podaj imię i nazwisko klienta.');
  end if;
  if app.clean_text(p ->> 'street') is null then
    perform app.fail('validation', 'Podaj ulicę i numer budynku/lokalu.');
  end if;
  v_postal := app.normalize_postal_code(p ->> 'postal_code');
  if v_postal is null or v_postal !~ '^[0-9]{2}-[0-9]{3}$' then
    perform app.fail('validation', 'Podaj poprawny kod pocztowy w formacie 00-000.');
  end if;
  if app.clean_text(p ->> 'city') is null then
    perform app.fail('validation', 'Podaj miejscowość.');
  end if;
  if app.clean_text(p ->> 'description') is null then
    perform app.fail('validation', 'Dodaj krótki opis montażu.');
  end if;
  begin
    v_start := (p ->> 'requested_start')::date;
    v_end := coalesce((p ->> 'requested_end')::date, v_start);
  exception when others then
    perform app.fail('validation', 'Podaj poprawną datę montażu.');
  end;
  if v_start is null then
    perform app.fail('validation', 'Wybierz termin montażu.');
  end if;
  if v_end < v_start then
    perform app.fail('validation', 'Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.');
  end if;
  if v_end - v_start >= 60 then
    perform app.fail('validation', 'Montaż może trwać maksymalnie 60 dni.');
  end if;
  v_phone := app.clean_text(p ->> 'customer_phone');
  if v_phone is not null and regexp_replace(v_phone, '[\s\-()]', '', 'g') !~ '^\+?[0-9]{9,15}$' then
    perform app.fail('validation', 'Podaj poprawny numer telefonu klienta (np. 600 100 200).');
  end if;
  if length(coalesce(p ->> 'description', '')) > 4000 then
    perform app.fail('validation', 'Opis jest zbyt długi (maks. 4000 znaków).');
  end if;

  v := jsonb_build_object(
    'customer_name', trim(p ->> 'customer_name'),
    'customer_phone', v_phone,
    'street', trim(p ->> 'street'),
    'postal_code', v_postal,
    'city', trim(p ->> 'city'),
    'description', trim(p ->> 'description'),
    'estimated_duration', app.clean_text(p ->> 'estimated_duration'),
    'access_instructions', app.clean_text(p ->> 'access_instructions'),
    'notes', app.clean_text(p ->> 'notes'),
    'requested_start', v_start,
    'requested_end', v_end
  );
  return v;
end $$;

create or replace function app.insert_measurements(p_job uuid, p_company uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_pos int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if app.clean_text(v_item ->> 'label') is null then
      perform app.fail('validation', 'Każdy wymiar musi mieć nazwę (np. „Okno kuchenne”).');
    end if;
    insert into public.job_measurements (job_id, company_id, label, width, height, unit, quantity, notes, position)
    values (
      p_job, p_company,
      trim(v_item ->> 'label'),
      nullif(v_item ->> 'width', '')::numeric,
      nullif(v_item ->> 'height', '')::numeric,
      coalesce(nullif(v_item ->> 'unit', ''), 'mm'),
      coalesce(nullif(v_item ->> 'quantity', '')::int, 1),
      app.clean_text(v_item ->> 'notes'),
      v_pos
    );
    v_pos := v_pos + 1;
  end loop;
exception
  when check_violation or invalid_text_representation then
    perform app.fail('validation', 'Sprawdź wymiary: szerokość i wysokość muszą być dodatnimi liczbami, ilość od 1 do 999.');
end $$;

-- Verifies that a crew can take the given inclusive date range. Locks the crew row so that
-- concurrent confirmations and block creation for the same crew are serialised. The
-- exclusion constraint on jobs is the final guarantee against double booking.
create or replace function app.assert_crew_available(
  p_company uuid, p_crew uuid, p_start date, p_end date, p_ignore_job uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_crew public.crews;
  v_conflict text;
begin
  select * into v_crew from public.crews where id = p_crew and company_id = p_company for update;
  if v_crew.id is null then
    perform app.fail('crew_not_found', 'Wybrana ekipa nie istnieje.');
  end if;
  if not v_crew.active then
    perform app.fail('crew_inactive', 'Wybrana ekipa jest nieaktywna.');
  end if;

  if exists (
    select 1 from public.availability_blocks b
    where b.company_id = p_company
      and (b.crew_id is null or b.crew_id = p_crew)
      and b.span && daterange(p_start, p_end, '[]')
  ) then
    perform app.fail('date_blocked', 'Wybrany termin jest zablokowany w kalendarzu dostępności.');
  end if;

  select string_agg(j.reference, ', ' order by j.confirmed_start) into v_conflict
  from public.jobs j
  where j.crew_id = p_crew
    and j.status in ('confirmed', 'in_progress')
    and j.confirmed_span && daterange(p_start, p_end, '[]')
    and (p_ignore_job is null or j.id <> p_ignore_job);
  if v_conflict is not null then
    perform app.fail('crew_conflict', format('Ekipa „%s” ma już w tym terminie zlecenie: %s.', v_crew.name, v_conflict));
  end if;
end $$;

-- Defense in depth: only the documented status transitions are possible.
create or replace function app.enforce_job_transition() returns trigger
language plpgsql as $$
begin
  if new.company_id <> old.company_id or new.store_id <> old.store_id then
    raise exception 'Nie można przenieść zlecenia do innej firmy lub sklepu.';
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'pending' and new.status in ('confirmed', 'rejected', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status = 'completed')
  ) then
    perform app.fail('invalid_transition', 'Ta zmiana statusu nie jest dozwolona.');
  end if;
  return new;
end $$;

create trigger jobs_enforce_transition before update on public.jobs
  for each row execute function app.enforce_job_transition();

create or replace function app.default_crew(p_company uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.crews where company_id = p_company and active
  order by is_default desc, created_at limit 1
$$;

create or replace function app.job_for_update(p_job uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v public.jobs;
begin
  select * into v from public.jobs where id = p_job for update;
  if v.id is null or not app.can_view_job(p_job) then
    perform app.fail('not_found', 'Nie znaleziono zlecenia.');
  end if;
  return v;
end $$;

create or replace function app.require_admin(p_company uuid) returns void
language plpgsql stable as $$
begin
  if not app.is_admin(p_company) then
    perform app.fail('forbidden', 'Tę operację może wykonać tylko administrator firmy montażowej.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Internal confirmation step (shared by confirm_job and admin-created jobs)
-- ---------------------------------------------------------------------------
create or replace function app.do_confirm(p_job public.jobs, p_crew uuid, p_start date, p_end date) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_crew uuid := coalesce(p_crew, app.default_crew(p_job.company_id));
  v_start date := coalesce(p_start, p_job.requested_start);
  v_end date := coalesce(p_end, p_start, p_job.requested_end);
  v_job public.jobs;
begin
  if v_crew is null then
    perform app.fail('no_crew', 'Dodaj co najmniej jedną aktywną ekipę, aby potwierdzić zlecenie.');
  end if;
  if v_end < v_start then
    perform app.fail('validation', 'Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.');
  end if;
  perform app.assert_crew_available(p_job.company_id, v_crew, v_start, v_end, p_job.id);
  begin
    update public.jobs
      set status = 'confirmed', crew_id = v_crew, confirmed_start = v_start, confirmed_end = v_end,
          rejection_reason = null
      where id = p_job.id
      returning * into v_job;
  exception when exclusion_violation then
    perform app.fail('crew_conflict', 'Ekipa ma już zlecenie w tym terminie. Odśwież kalendarz i wybierz inny termin lub ekipę.');
  end;
  perform app.log_activity(v_job.id, v_job.company_id, 'confirmed', jsonb_build_object(
    'crew_id', v_crew,
    'crew_name', (select name from public.crews where id = v_crew),
    'start', v_start, 'end', v_end
  ));
  perform app.notify_job_event(v_job.id, 'job_confirmed', '{}'::jsonb);
  return v_job;
end $$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- Creates a booking request. Store users create requests for their own store only.
-- Administrators can create on behalf of any company store and optionally confirm at once.
create or replace function public.submit_job_request(
  p_store_id uuid,
  p_job jsonb,
  p_measurements jsonb default '[]'::jsonb,
  p_confirm boolean default false,
  p_crew_id uuid default null
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_store public.stores;
  v_is_admin boolean;
  v_data jsonb;
  v_job public.jobs;
begin
  if auth.uid() is null then
    perform app.fail('auth', 'Zaloguj się, aby kontynuować.');
  end if;
  select * into v_store from public.stores where id = p_store_id;
  if v_store.id is null then
    perform app.fail('not_found', 'Nie znaleziono sklepu.');
  end if;
  v_is_admin := app.is_admin(v_store.company_id);
  if not v_is_admin and p_store_id not in (select app.user_store_ids()) then
    perform app.fail('not_found', 'Nie znaleziono sklepu.');
  end if;
  if not v_store.active then
    perform app.fail('store_inactive', 'Ten sklep jest nieaktywny.');
  end if;
  perform app.assert_can_write(v_store.company_id);

  v_data := app.validate_job_payload(p_job);
  if not v_is_admin and (v_data ->> 'requested_start')::date < app.today_pl() then
    perform app.fail('validation', 'Nie można zgłosić montażu z datą w przeszłości.');
  end if;

  insert into public.jobs (
    company_id, store_id, reference, customer_name, customer_phone, street, postal_code, city,
    description, estimated_duration, access_instructions, notes, requested_start, requested_end, created_by
  ) values (
    v_store.company_id, v_store.id, app.next_job_reference(v_store.company_id),
    v_data ->> 'customer_name', v_data ->> 'customer_phone', v_data ->> 'street', v_data ->> 'postal_code',
    v_data ->> 'city', v_data ->> 'description', v_data ->> 'estimated_duration',
    v_data ->> 'access_instructions', v_data ->> 'notes',
    (v_data ->> 'requested_start')::date, (v_data ->> 'requested_end')::date, auth.uid()
  ) returning * into v_job;

  perform app.insert_measurements(v_job.id, v_job.company_id, p_measurements);
  perform app.log_activity(v_job.id, v_job.company_id, 'created', jsonb_build_object(
    'start', v_job.requested_start, 'end', v_job.requested_end, 'by_admin', v_is_admin
  ));

  if p_confirm and v_is_admin then
    v_job := app.do_confirm(v_job, p_crew_id, v_job.requested_start, v_job.requested_end);
  elsif not v_is_admin then
    perform app.notify_job_event(v_job.id, 'job_requested', '{}'::jsonb);
  end if;
  return v_job;
end $$;

-- Edits job details. Stores: only pending requests of their own store. Admins: any active job.
-- Confirmed dates are never changed here (use reschedule_job).
create or replace function public.update_job_request(p_job_id uuid, p_job jsonb) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
  v_data jsonb;
  v_is_admin boolean := app.is_admin(v_job.company_id);
  v_changed text[];
begin
  perform app.assert_can_write(v_job.company_id);
  if not app.can_edit_job_details(p_job_id) then
    if v_is_admin then
      perform app.fail('locked', 'Zakończonych, odrzuconych ani anulowanych zleceń nie można edytować.');
    end if;
    perform app.fail('locked', 'Zgłoszenie można edytować tylko, dopóki oczekuje na akceptację. Skontaktuj się z firmą montażową.');
  end if;
  v_data := app.validate_job_payload(p_job);
  if v_job.status <> 'pending' and (
    (v_data ->> 'requested_start')::date <> v_job.requested_start or (v_data ->> 'requested_end')::date <> v_job.requested_end
  ) then
    perform app.fail('locked', 'Termin potwierdzonego zlecenia zmienisz przyciskiem „Zmień termin”.');
  end if;
  if not v_is_admin and (v_data ->> 'requested_start')::date < app.today_pl()
     and (v_data ->> 'requested_start')::date <> v_job.requested_start then
    perform app.fail('validation', 'Nie można wybrać daty z przeszłości.');
  end if;

  select array_agg(key) into v_changed
  from jsonb_each(v_data) n
  where n.value is distinct from (to_jsonb(v_job) -> n.key);

  update public.jobs set
    customer_name = v_data ->> 'customer_name',
    customer_phone = v_data ->> 'customer_phone',
    street = v_data ->> 'street',
    postal_code = v_data ->> 'postal_code',
    city = v_data ->> 'city',
    description = v_data ->> 'description',
    estimated_duration = v_data ->> 'estimated_duration',
    access_instructions = v_data ->> 'access_instructions',
    notes = v_data ->> 'notes',
    requested_start = (v_data ->> 'requested_start')::date,
    requested_end = (v_data ->> 'requested_end')::date
  where id = p_job_id
  returning * into v_job;

  if v_changed is not null then
    perform app.log_activity(v_job.id, v_job.company_id, 'updated', jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return v_job;
end $$;

create or replace function public.withdraw_job_request(p_job_id uuid, p_reason text default null) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
begin
  perform app.assert_can_write(v_job.company_id);
  if v_job.store_id not in (select app.user_store_ids()) and not app.is_admin(v_job.company_id) then
    perform app.fail('forbidden', 'Nie masz uprawnień do wycofania tego zgłoszenia.');
  end if;
  if v_job.status <> 'pending' then
    perform app.fail('locked', 'Wycofać można tylko zgłoszenie oczekujące na akceptację.');
  end if;
  update public.jobs set status = 'cancelled', cancellation_reason = app.clean_text(p_reason)
    where id = p_job_id returning * into v_job;
  perform app.log_activity(v_job.id, v_job.company_id, 'withdrawn', jsonb_build_object('reason', app.clean_text(p_reason)));
  perform app.notify_job_event(v_job.id, 'job_withdrawn', '{}'::jsonb);
  return v_job;
end $$;

create or replace function public.confirm_job(
  p_job_id uuid, p_crew_id uuid default null, p_start date default null, p_end date default null
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
begin
  perform app.require_admin(v_job.company_id);
  perform app.assert_can_write(v_job.company_id);
  if v_job.status <> 'pending' then
    perform app.fail('invalid_transition', 'Potwierdzić można tylko zgłoszenie oczekujące na akceptację.');
  end if;
  return app.do_confirm(v_job, p_crew_id, coalesce(p_start, v_job.requested_start), coalesce(p_end, p_start, v_job.requested_end));
end $$;

create or replace function public.reject_job(p_job_id uuid, p_reason text default null) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
begin
  perform app.require_admin(v_job.company_id);
  perform app.assert_can_write(v_job.company_id);
  if v_job.status <> 'pending' then
    perform app.fail('invalid_transition', 'Odrzucić można tylko zgłoszenie oczekujące na akceptację.');
  end if;
  update public.jobs set status = 'rejected', rejection_reason = app.clean_text(p_reason)
    where id = p_job_id returning * into v_job;
  perform app.log_activity(v_job.id, v_job.company_id, 'rejected', jsonb_build_object('reason', app.clean_text(p_reason)));
  perform app.notify_job_event(v_job.id, 'job_rejected', '{}'::jsonb);
  return v_job;
end $$;

-- Cancels a pending or confirmed job. Returns released dates so the UI can offer an announcement.
create or replace function public.cancel_job(p_job_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
  v_was_confirmed boolean;
  v_released jsonb := null;
begin
  perform app.require_admin(v_job.company_id);
  perform app.assert_can_write(v_job.company_id);
  if v_job.status not in ('pending', 'confirmed') then
    perform app.fail('invalid_transition', 'Anulować można zgłoszenie oczekujące lub potwierdzone zlecenie.');
  end if;
  v_was_confirmed := v_job.status = 'confirmed';
  update public.jobs set status = 'cancelled', cancellation_reason = app.clean_text(p_reason)
    where id = p_job_id returning * into v_job;
  perform app.log_activity(v_job.id, v_job.company_id, 'cancelled', jsonb_build_object('reason', app.clean_text(p_reason)));
  perform app.notify_job_event(v_job.id, 'job_cancelled', '{}'::jsonb);
  if v_was_confirmed and v_job.confirmed_end >= app.today_pl() then
    v_released := jsonb_build_object(
      'start', greatest(v_job.confirmed_start, app.today_pl()),
      'end', v_job.confirmed_end,
      'crew_id', v_job.crew_id
    );
    perform app.notify_date_released(v_job.company_id, v_job.id, greatest(v_job.confirmed_start, app.today_pl()), v_job.confirmed_end);
  end if;
  return jsonb_build_object('job', to_jsonb(v_job), 'released', v_released);
end $$;

-- Moves a confirmed (or in-progress) job to new dates and/or another crew with the same checks
-- as confirmation. Attachments, measurements and history stay attached to the job.
create or replace function public.reschedule_job(
  p_job_id uuid, p_start date, p_end date, p_crew_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
  v_old public.jobs;
  v_crew uuid;
  v_released jsonb := null;
begin
  perform app.require_admin(v_job.company_id);
  perform app.assert_can_write(v_job.company_id);
  if v_job.status not in ('confirmed', 'in_progress') then
    perform app.fail('invalid_transition', 'Zmienić termin można tylko w potwierdzonym zleceniu. Dla zgłoszeń oczekujących edytuj proponowany termin.');
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    perform app.fail('validation', 'Podaj poprawny zakres dat.');
  end if;
  if p_end - p_start >= 60 then
    perform app.fail('validation', 'Montaż może trwać maksymalnie 60 dni.');
  end if;
  v_old := v_job;
  v_crew := coalesce(p_crew_id, v_job.crew_id);
  if v_crew = v_old.crew_id and p_start = v_old.confirmed_start and p_end = v_old.confirmed_end then
    return jsonb_build_object('job', to_jsonb(v_job), 'released', null);
  end if;
  perform app.assert_crew_available(v_job.company_id, v_crew, p_start, p_end, v_job.id);
  begin
    update public.jobs set confirmed_start = p_start, confirmed_end = p_end, crew_id = v_crew
      where id = p_job_id returning * into v_job;
  exception when exclusion_violation then
    perform app.fail('crew_conflict', 'Ekipa ma już zlecenie w tym terminie. Wybierz inny termin lub ekipę.');
  end;
  perform app.log_activity(v_job.id, v_job.company_id, 'rescheduled', jsonb_build_object(
    'from_start', v_old.confirmed_start, 'from_end', v_old.confirmed_end,
    'to_start', p_start, 'to_end', p_end,
    'from_crew', (select name from public.crews where id = v_old.crew_id),
    'to_crew', (select name from public.crews where id = v_crew)
  ));
  perform app.notify_job_event(v_job.id, 'job_rescheduled', jsonb_build_object(
    'old_start', v_old.confirmed_start, 'old_end', v_old.confirmed_end, 'old_crew_id', v_old.crew_id
  ));
  -- Days that were occupied before and are free now (for the same crew).
  if v_old.confirmed_end >= app.today_pl() and (
    v_crew <> v_old.crew_id or p_start > v_old.confirmed_start or p_end < v_old.confirmed_end
  ) then
    v_released := jsonb_build_object(
      'start', greatest(v_old.confirmed_start, app.today_pl()),
      'end', v_old.confirmed_end,
      'crew_id', v_old.crew_id
    );
    perform app.notify_date_released(v_job.company_id, v_job.id, greatest(v_old.confirmed_start, app.today_pl()), v_old.confirmed_end);
  end if;
  return jsonb_build_object('job', to_jsonb(v_job), 'released', v_released);
end $$;

create or replace function app.assert_can_work_on(p_job public.jobs) returns void
language plpgsql stable as $$
begin
  if not (app.is_admin(p_job.company_id) or (p_job.crew_id is not null and p_job.crew_id in (select app.user_crew_ids()))) then
    perform app.fail('forbidden', 'To zlecenie nie jest przypisane do Twojej ekipy.');
  end if;
end $$;

create or replace function public.start_job(p_job_id uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
begin
  perform app.assert_can_work_on(v_job);
  perform app.assert_can_write(v_job.company_id);
  if v_job.status <> 'confirmed' then
    perform app.fail('invalid_transition', 'Rozpocząć można tylko potwierdzone zlecenie.');
  end if;
  update public.jobs set status = 'in_progress', started_at = now() where id = p_job_id returning * into v_job;
  perform app.log_activity(v_job.id, v_job.company_id, 'started');
  return v_job;
end $$;

create or replace function public.complete_job(p_job_id uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.jobs := app.job_for_update(p_job_id);
begin
  perform app.assert_can_work_on(v_job);
  perform app.assert_can_write(v_job.company_id);
  if v_job.status <> 'in_progress' then
    perform app.fail('invalid_transition', 'Zakończyć można tylko zlecenie w realizacji.');
  end if;
  update public.jobs set status = 'completed', completed_at = now() where id = p_job_id returning * into v_job;
  perform app.log_activity(v_job.id, v_job.company_id, 'completed');
  perform app.notify_job_event(v_job.id, 'job_completed', '{}'::jsonb);
  return v_job;
end $$;

-- Daily availability for a date window. Contains no customer or store data, so every member
-- (including store users) may call it. Pending counts are returned to administrators only.
create or replace function public.get_availability(p_company_id uuid, p_from date, p_to date)
returns table (day date, total_crews int, busy_crews int, blocked boolean, status text, pending_requests int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean;
begin
  if not app.can_read(p_company_id) then
    perform app.fail('not_found', 'Brak dostępu do kalendarza tej firmy.');
  end if;
  if p_to < p_from or p_to - p_from > 120 then
    perform app.fail('validation', 'Nieprawidłowy zakres dat.');
  end if;
  v_admin := app.is_admin(p_company_id);
  return query
  with days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  ),
  crews as (
    select c.id from public.crews c where c.company_id = p_company_id and c.active
  ),
  per_day as (
    select
      days.day,
      (select count(*) from crews)::int as total,
      (select count(*) from crews c where exists (
        select 1 from public.jobs j
        where j.crew_id = c.id and j.status in ('confirmed', 'in_progress') and j.confirmed_span @> days.day
      ) or exists (
        select 1 from public.availability_blocks b
        where b.company_id = p_company_id and b.crew_id = c.id and b.span @> days.day
      ))::int as busy,
      exists (
        select 1 from public.availability_blocks b
        where b.company_id = p_company_id and b.crew_id is null and b.span @> days.day
      ) as company_blocked,
      (select count(*) from public.jobs j
        where j.company_id = p_company_id and j.status = 'pending' and j.requested_span @> days.day)::int as pending
    from days
  )
  select
    per_day.day,
    per_day.total,
    case when per_day.company_blocked then per_day.total else per_day.busy end,
    per_day.company_blocked,
    case
      when per_day.company_blocked then 'blocked'
      when per_day.total = 0 then 'full'
      when per_day.busy >= per_day.total then 'full'
      when per_day.busy > 0 then 'partial'
      else 'available'
    end,
    case when v_admin then per_day.pending else null end
  from per_day
  order by per_day.day;
end $$;

create or replace function public.create_availability_block(
  p_company_id uuid, p_start date, p_end date, p_crew_id uuid default null, p_reason text default null
) returns public.availability_blocks
language plpgsql security definer set search_path = '' as $$
declare
  v_block public.availability_blocks;
  v_conflict text;
begin
  perform app.require_admin(p_company_id);
  perform app.assert_can_write(p_company_id);
  if p_start is null or p_end is null or p_end < p_start then
    perform app.fail('validation', 'Podaj poprawny zakres dat.');
  end if;
  if p_end - p_start > 366 then
    perform app.fail('validation', 'Blokada może obejmować maksymalnie rok.');
  end if;
  -- Lock affected crews so a concurrent confirmation cannot slip in.
  perform 1 from public.crews where company_id = p_company_id and (p_crew_id is null or id = p_crew_id) for update;
  if p_crew_id is not null and not found then
    perform app.fail('crew_not_found', 'Wybrana ekipa nie istnieje.');
  end if;
  select string_agg(j.reference, ', ' order by j.confirmed_start) into v_conflict
  from public.jobs j
  where j.company_id = p_company_id
    and j.status in ('confirmed', 'in_progress')
    and (p_crew_id is null or j.crew_id = p_crew_id)
    and j.confirmed_span && daterange(p_start, p_end, '[]');
  if v_conflict is not null then
    perform app.fail('block_conflict', format('W tym terminie są potwierdzone zlecenia: %s. Najpierw zmień ich termin lub anuluj je.', v_conflict));
  end if;
  insert into public.availability_blocks (company_id, crew_id, start_date, end_date, reason, created_by)
  values (p_company_id, p_crew_id, p_start, p_end, app.clean_text(p_reason), auth.uid())
  returning * into v_block;
  perform app.audit(p_company_id, 'availability_block.created', 'availability_block', v_block.id::text,
    jsonb_build_object('start', p_start, 'end', p_end, 'crew_id', p_crew_id));
  return v_block;
end $$;

create or replace function public.set_plan_order(p_company_id uuid, p_date date, p_job_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i int;
begin
  perform app.require_admin(p_company_id);
  perform app.assert_can_write(p_company_id);
  if exists (select 1 from unnest(p_job_ids) as u(job_id) where not exists (
    select 1 from public.jobs j where j.id = u.job_id and j.company_id = p_company_id
  )) then
    perform app.fail('not_found', 'Nie znaleziono zlecenia.');
  end if;
  delete from public.plan_positions where company_id = p_company_id and plan_date = p_date;
  for i in 1 .. coalesce(array_length(p_job_ids, 1), 0) loop
    insert into public.plan_positions (company_id, plan_date, job_id, position)
    values (p_company_id, p_date, p_job_ids[i], i);
  end loop;
end $$;
