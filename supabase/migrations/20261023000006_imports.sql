-- Excel/CSV import of partner stores and jobs.
-- The client parses the file and maps columns to canonical keys; the server is the only
-- authority on validation and duplicates, and always imports into the company the caller
-- administers (spreadsheet values can never select a tenant).

-- Session flag used to suppress notifications while importing.
create or replace function app.notifications_suppressed() returns boolean
language sql stable as $$ select coalesce(current_setting('flowmont.suppress_notifications', true), '') = 'on' $$;

create or replace function app.enqueue(
  p_company uuid, p_event text, p_channel public.notification_channel, p_recipient text, p_label text,
  p_subject text, p_body text, p_key text, p_job uuid default null, p_announcement uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if app.notifications_suppressed() then
    return;
  end if;
  insert into public.notification_outbox
    (company_id, event_type, channel, recipient, recipient_label, subject, body, idempotency_key, job_id, announcement_id)
  values
    (p_company, p_event, p_channel, trim(p_recipient), p_label, p_subject, p_body, p_key, p_job, p_announcement)
  on conflict (idempotency_key) do nothing;
end $$;

create or replace function app.try_date(p text) returns date
language plpgsql immutable as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end $$;

-- Validates import rows. Returns one element per row:
-- {"row": n, "data": {...normalised...}, "errors": [{"field","message"}], "duplicate": bool}
create or replace function app.import_validate(p_company uuid, p_kind text, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_row jsonb;
  v_idx int := 0;
  v_errors jsonb;
  v_data jsonb;
  v_dup boolean;
  v_seen_names text[] := '{}';
  v_seen_nips text[] := '{}';
  v_seen_refs text[] := '{}';
  v_seen_jobs text[] := '{}';
  v_name text;
  v_nip text;
  v_email text;
  v_postal text;
  v_phone text;
  v_store_id uuid;
  v_start date;
  v_end date;
  v_ref text;
  v_job_key text;
  v_status text;
  v_crew_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    perform app.fail('validation', 'Nieprawidłowe dane importu.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    perform app.fail('validation', 'Plik może zawierać maksymalnie 2000 wierszy.');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_errors := '[]'::jsonb;
    v_dup := false;
    v_postal := app.normalize_postal_code(app.clean_text(v_row ->> 'postal_code'));
    v_phone := app.clean_text(v_row ->> 'phone');

    if p_kind = 'stores' then
      v_name := app.clean_text(v_row ->> 'name');
      v_nip := nullif(regexp_replace(coalesce(v_row ->> 'nip', ''), '[^0-9]', '', 'g'), '');
      v_email := lower(app.clean_text(v_row ->> 'email'));
      if v_name is null then
        v_errors := v_errors || jsonb_build_object('field', 'name', 'message', 'Brak nazwy sklepu.');
      elsif length(v_name) > 160 then
        v_errors := v_errors || jsonb_build_object('field', 'name', 'message', 'Nazwa sklepu jest zbyt długa.');
      end if;
      if v_nip is not null and length(v_nip) <> 10 then
        v_errors := v_errors || jsonb_build_object('field', 'nip', 'message', 'NIP musi mieć 10 cyfr.');
      end if;
      if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        v_errors := v_errors || jsonb_build_object('field', 'email', 'message', 'Nieprawidłowy adres e-mail.');
      end if;
      if v_postal is not null and v_postal !~ '^[0-9]{2}-[0-9]{3}$' then
        v_errors := v_errors || jsonb_build_object('field', 'postal_code', 'message', 'Kod pocztowy musi mieć format 00-000.');
      end if;
      if v_phone is not null and regexp_replace(v_phone, '[\s\-()]', '', 'g') !~ '^\+?[0-9]{9,15}$' then
        v_errors := v_errors || jsonb_build_object('field', 'phone', 'message', 'Nieprawidłowy numer telefonu.');
      end if;
      if v_name is not null and (
        lower(v_name) = any(v_seen_names)
        or exists (select 1 from public.stores s where s.company_id = p_company and lower(trim(s.name)) = lower(v_name))
      ) then
        v_dup := true;
        v_errors := v_errors || jsonb_build_object('field', 'name', 'message', 'Sklep o tej nazwie już istnieje (duplikat).');
      elsif v_nip is not null and (
        v_nip = any(v_seen_nips)
        or exists (select 1 from public.stores s where s.company_id = p_company and regexp_replace(coalesce(s.nip, ''), '[^0-9]', '', 'g') = v_nip)
      ) then
        v_dup := true;
        v_errors := v_errors || jsonb_build_object('field', 'nip', 'message', 'Sklep z tym numerem NIP już istnieje (duplikat).');
      end if;
      if v_name is not null then v_seen_names := v_seen_names || lower(v_name); end if;
      if v_nip is not null then v_seen_nips := v_seen_nips || v_nip; end if;
      v_data := jsonb_build_object(
        'name', v_name, 'nip', v_nip, 'email', v_email, 'phone', v_phone,
        'street', app.clean_text(v_row ->> 'street'), 'postal_code', v_postal, 'city', app.clean_text(v_row ->> 'city'),
        'contact_person', app.clean_text(v_row ->> 'contact_person'), 'notes', app.clean_text(v_row ->> 'notes')
      );

    elsif p_kind = 'jobs' then
      v_store_id := null;
      v_crew_id := null;
      v_name := app.clean_text(v_row ->> 'store_name');
      if v_name is null then
        v_errors := v_errors || jsonb_build_object('field', 'store_name', 'message', 'Brak nazwy sklepu.');
      else
        select s.id into v_store_id from public.stores s
        where s.company_id = p_company and s.active and lower(trim(s.name)) = lower(v_name);
        if v_store_id is null then
          v_errors := v_errors || jsonb_build_object('field', 'store_name', 'message', 'Nie znaleziono aktywnego sklepu o tej nazwie. Najpierw zaimportuj lub dodaj sklep.');
        end if;
      end if;
      if app.clean_text(v_row ->> 'customer_name') is null then
        v_errors := v_errors || jsonb_build_object('field', 'customer_name', 'message', 'Brak imienia i nazwiska klienta.');
      end if;
      if app.clean_text(v_row ->> 'street') is null then
        v_errors := v_errors || jsonb_build_object('field', 'street', 'message', 'Brak ulicy i numeru.');
      end if;
      if v_postal is null or v_postal !~ '^[0-9]{2}-[0-9]{3}$' then
        v_errors := v_errors || jsonb_build_object('field', 'postal_code', 'message', 'Kod pocztowy musi mieć format 00-000.');
      end if;
      if app.clean_text(v_row ->> 'city') is null then
        v_errors := v_errors || jsonb_build_object('field', 'city', 'message', 'Brak miejscowości.');
      end if;
      if app.clean_text(v_row ->> 'description') is null then
        v_errors := v_errors || jsonb_build_object('field', 'description', 'message', 'Brak opisu montażu.');
      end if;
      v_phone := app.clean_text(v_row ->> 'customer_phone');
      if v_phone is not null and regexp_replace(v_phone, '[\s\-()]', '', 'g') !~ '^\+?[0-9]{9,15}$' then
        v_errors := v_errors || jsonb_build_object('field', 'customer_phone', 'message', 'Nieprawidłowy numer telefonu.');
      end if;
      v_start := app.try_date(v_row ->> 'requested_start');
      v_end := coalesce(app.try_date(v_row ->> 'requested_end'), v_start);
      if v_start is null then
        v_errors := v_errors || jsonb_build_object('field', 'requested_start', 'message', 'Nieprawidłowa data rozpoczęcia (oczekiwany format RRRR-MM-DD lub DD.MM.RRRR).');
      elsif app.clean_text(v_row ->> 'requested_end') is not null and app.try_date(v_row ->> 'requested_end') is null then
        v_errors := v_errors || jsonb_build_object('field', 'requested_end', 'message', 'Nieprawidłowa data zakończenia.');
      elsif v_end < v_start then
        v_errors := v_errors || jsonb_build_object('field', 'requested_end', 'message', 'Data zakończenia jest wcześniejsza niż data rozpoczęcia.');
      elsif v_end - v_start >= 60 then
        v_errors := v_errors || jsonb_build_object('field', 'requested_end', 'message', 'Montaż może trwać maksymalnie 60 dni.');
      end if;
      v_status := lower(coalesce(app.clean_text(v_row ->> 'status'), 'oczekuje'));
      if v_status in ('oczekuje', 'oczekuje na akceptację', 'pending') then
        v_status := 'pending';
      elsif v_status in ('potwierdzone', 'confirmed') then
        v_status := 'confirmed';
        if app.clean_text(v_row ->> 'crew_name') is not null then
          select c.id into v_crew_id from public.crews c
          where c.company_id = p_company and c.active and lower(trim(c.name)) = lower(trim(v_row ->> 'crew_name'));
          if v_crew_id is null then
            v_errors := v_errors || jsonb_build_object('field', 'crew_name', 'message', 'Nie znaleziono aktywnej ekipy o tej nazwie.');
          end if;
        else
          v_crew_id := app.default_crew(p_company);
        end if;
      else
        v_errors := v_errors || jsonb_build_object('field', 'status', 'message', 'Status musi mieć wartość „oczekuje” lub „potwierdzone”.');
      end if;
      v_ref := app.clean_text(v_row ->> 'external_ref');
      v_job_key := lower(coalesce(v_name, '') || '|' || coalesce(trim(v_row ->> 'customer_name'), '') || '|' ||
                         coalesce(trim(v_row ->> 'street'), '') || '|' || coalesce(v_start::text, ''));
      if v_ref is not null and (
        v_ref = any(v_seen_refs)
        or exists (select 1 from public.jobs j where j.company_id = p_company and j.external_ref = v_ref)
      ) then
        v_dup := true;
        v_errors := v_errors || jsonb_build_object('field', 'external_ref', 'message', 'Zlecenie o tym numerze zewnętrznym już istnieje (duplikat).');
      elsif v_job_key = any(v_seen_jobs) or exists (
        select 1 from public.jobs j
        where j.company_id = p_company and j.store_id = v_store_id
          and lower(trim(j.customer_name)) = lower(trim(v_row ->> 'customer_name'))
          and lower(trim(j.street)) = lower(trim(v_row ->> 'street'))
          and j.requested_start = v_start
          and j.status not in ('rejected', 'cancelled')
      ) then
        v_dup := true;
        v_errors := v_errors || jsonb_build_object('field', 'customer_name', 'message', 'Takie zlecenie (sklep, klient, adres, data) już istnieje (duplikat).');
      end if;
      if v_ref is not null then v_seen_refs := v_seen_refs || v_ref; end if;
      v_seen_jobs := v_seen_jobs || v_job_key;
      v_data := jsonb_build_object(
        'store_id', v_store_id, 'store_name', v_name,
        'customer_name', app.clean_text(v_row ->> 'customer_name'), 'customer_phone', v_phone,
        'street', app.clean_text(v_row ->> 'street'), 'postal_code', v_postal, 'city', app.clean_text(v_row ->> 'city'),
        'description', app.clean_text(v_row ->> 'description'),
        'estimated_duration', app.clean_text(v_row ->> 'estimated_duration'),
        'access_instructions', app.clean_text(v_row ->> 'access_instructions'),
        'notes', app.clean_text(v_row ->> 'notes'),
        'requested_start', v_start, 'requested_end', v_end,
        'status', v_status, 'crew_id', v_crew_id, 'external_ref', v_ref
      );
    else
      perform app.fail('validation', 'Nieznany typ importu.');
    end if;

    v_out := v_out || jsonb_build_object('row', v_idx, 'data', v_data, 'errors', v_errors, 'duplicate', v_dup, 'raw', v_row);
  end loop;
  return v_out;
end $$;

create or replace function public.import_preview(p_company_id uuid, p_kind text, p_file_name text, p_rows jsonb)
returns public.import_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_run public.import_runs;
  v_item jsonb;
  v_err jsonb;
begin
  perform app.require_admin(p_company_id);
  perform app.assert_can_write(p_company_id);
  v_result := app.import_validate(p_company_id, p_kind, p_rows);
  insert into public.import_runs (company_id, kind, file_name, total_rows, valid_rows, invalid_rows, duplicate_rows, rows, created_by)
  select p_company_id, p_kind, left(p_file_name, 200),
    jsonb_array_length(v_result),
    count(*) filter (where jsonb_array_length(e -> 'errors') = 0),
    count(*) filter (where jsonb_array_length(e -> 'errors') > 0 and not (e ->> 'duplicate')::boolean),
    count(*) filter (where (e ->> 'duplicate')::boolean),
    v_result, auth.uid()
  from jsonb_array_elements(v_result) e
  returning * into v_run;
  for v_item in select * from jsonb_array_elements(v_result) loop
    for v_err in select * from jsonb_array_elements(v_item -> 'errors') loop
      insert into public.import_row_errors (import_run_id, company_id, row_number, field, message, is_duplicate)
      values (v_run.id, p_company_id, (v_item ->> 'row')::int, v_err ->> 'field', v_err ->> 'message', (v_item ->> 'duplicate')::boolean);
    end loop;
  end loop;
  return v_run;
end $$;

-- Imports the valid rows of a previewed run. Rows are validated again against the current
-- database state. Notifications/invitations are only sent when p_notify is explicitly true.
create or replace function public.import_commit(p_run_id uuid, p_notify boolean default false) returns public.import_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.import_runs;
  v_result jsonb;
  v_item jsonb;
  d jsonb;
  v_count int := 0;
  v_store public.stores;
  v_job public.jobs;
  v_failed int := 0;
begin
  select * into v_run from public.import_runs where id = p_run_id for update;
  if v_run.id is null or not app.is_admin(v_run.company_id) then
    perform app.fail('not_found', 'Nie znaleziono importu.');
  end if;
  perform app.assert_can_write(v_run.company_id);
  if v_run.status <> 'previewed' then
    perform app.fail('validation', 'Ten import został już zakończony.');
  end if;

  select coalesce(jsonb_agg(e -> 'raw' order by (e ->> 'row')::int), '[]'::jsonb) into v_result
  from jsonb_array_elements(v_run.rows) e;
  v_result := app.import_validate(v_run.company_id, v_run.kind, v_result);

  if not coalesce(p_notify, false) then
    perform set_config('flowmont.suppress_notifications', 'on', true);
  end if;

  for v_item in select * from jsonb_array_elements(v_result) loop
    continue when jsonb_array_length(v_item -> 'errors') > 0;
    d := v_item -> 'data';
    if v_run.kind = 'stores' then
      insert into public.stores (company_id, name, nip, email, phone, street, postal_code, city, contact_person, notes)
      values (v_run.company_id, d ->> 'name', d ->> 'nip', d ->> 'email', d ->> 'phone', d ->> 'street',
              d ->> 'postal_code', d ->> 'city', d ->> 'contact_person', d ->> 'notes')
      returning * into v_store;
      if coalesce(p_notify, false) and v_store.email is not null then
        perform public.create_invitation(v_run.company_id, v_store.email, 'store_user', v_store.id, null);
      end if;
      v_count := v_count + 1;
    else
      insert into public.jobs (
        company_id, store_id, reference, customer_name, customer_phone, street, postal_code, city, description,
        estimated_duration, access_instructions, notes, requested_start, requested_end, external_ref, import_run_id, created_by
      ) values (
        v_run.company_id, (d ->> 'store_id')::uuid, app.next_job_reference(v_run.company_id), d ->> 'customer_name',
        d ->> 'customer_phone', d ->> 'street', d ->> 'postal_code', d ->> 'city', d ->> 'description',
        d ->> 'estimated_duration', d ->> 'access_instructions', d ->> 'notes',
        (d ->> 'requested_start')::date, (d ->> 'requested_end')::date, d ->> 'external_ref', v_run.id, auth.uid()
      ) returning * into v_job;
      perform app.log_activity(v_job.id, v_job.company_id, 'imported', jsonb_build_object('import_run_id', v_run.id));
      if d ->> 'status' = 'confirmed' then
        begin
          v_job := app.do_confirm(v_job, (d ->> 'crew_id')::uuid, v_job.requested_start, v_job.requested_end);
        exception when others then
          -- Keep the job as a pending request when the crew is not available; report it.
          v_failed := v_failed + 1;
          insert into public.import_row_errors (import_run_id, company_id, row_number, field, message)
          values (v_run.id, v_run.company_id, (v_item ->> 'row')::int, 'status',
                  'Zaimportowano jako oczekujące – nie udało się potwierdzić: ' || sqlerrm);
        end;
      end if;
      v_count := v_count + 1;
    end if;
  end loop;

  update public.import_runs set status = 'committed', imported_rows = v_count, committed_at = now()
  where id = v_run.id returning * into v_run;
  perform app.audit(v_run.company_id, 'import.committed', 'import_run', v_run.id::text,
    jsonb_build_object('kind', v_run.kind, 'imported', v_count, 'confirm_failed', v_failed, 'notify', coalesce(p_notify, false)));
  perform set_config('flowmont.suppress_notifications', '', true);
  return v_run;
end $$;

create or replace function public.import_discard(p_run_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.import_runs;
begin
  select * into v_run from public.import_runs where id = p_run_id;
  if v_run.id is null or not app.is_admin(v_run.company_id) then
    perform app.fail('not_found', 'Nie znaleziono importu.');
  end if;
  update public.import_runs set status = 'discarded' where id = p_run_id and status = 'previewed';
end $$;
