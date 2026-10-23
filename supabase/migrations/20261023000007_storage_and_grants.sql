-- Private file storage for job photos and documents.
-- Object path convention: {company_id}/{job_id}/{random}-{file name}
-- Access to objects is authorised with the same job visibility rules as the database, so
-- signed URLs can only be created by users who may see the job.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-files', 'job-files', false, 20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.storage_job_id(p_name text) returns uuid
language plpgsql immutable as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if array_length(v_parts, 1) < 3 then
    return null;
  end if;
  return v_parts[2]::uuid;
exception when others then
  return null;
end $$;

create or replace function app.storage_company_id(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return (string_to_array(p_name, '/'))[1]::uuid;
exception when others then
  return null;
end $$;

create policy job_files_select on storage.objects for select to authenticated using (
  bucket_id = 'job-files'
  and app.can_view_job(app.storage_job_id(name))
  and app.storage_company_id(name) = app.job_company(app.storage_job_id(name))
);

create policy job_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'job-files'
  and app.can_add_files(app.storage_job_id(name))
  and app.storage_company_id(name) = app.job_company(app.storage_job_id(name))
);

create policy job_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'job-files'
  and app.storage_company_id(name) = app.job_company(app.storage_job_id(name))
  and app.can_write(app.storage_company_id(name))
  and (
    app.is_admin(app.storage_company_id(name))
    or (owner_id = auth.uid()::text and app.can_add_files(app.storage_job_id(name)))
  )
);

-- ---------------------------------------------------------------------------
-- Function privileges: nothing is executable by anonymous users except the invitation lookup.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on function public.get_invitation(text) to anon;
-- Worker-only functions.
revoke execute on function public.claim_outbox(int) from authenticated;
revoke execute on function public.finish_outbox(uuid, text, text, text, text) from authenticated;
revoke execute on function public.apply_billing_event(text, text, text, uuid, jsonb, public.subscription_status, text, text, text, timestamptz, boolean) from authenticated;
revoke execute on function public.expire_trials() from authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema app revoke execute on functions from public, anon;

-- Internal building blocks are only callable from the SECURITY DEFINER RPCs above.
revoke execute on function app.enqueue(uuid, text, public.notification_channel, text, text, text, text, text, uuid, uuid) from authenticated;
revoke execute on function app.log_activity(uuid, uuid, text, jsonb, boolean) from authenticated;
revoke execute on function app.audit(uuid, text, text, text, jsonb) from authenticated;
revoke execute on function app.do_confirm(public.jobs, uuid, date, date) from authenticated;
revoke execute on function app.notify_job_event(uuid, text, jsonb) from authenticated;
revoke execute on function app.notify_date_released(uuid, uuid, date, date) from authenticated;
revoke execute on function app.insert_measurements(uuid, uuid, jsonb) from authenticated;
revoke execute on function app.next_job_reference(uuid) from authenticated;
revoke execute on function app.assert_crew_available(uuid, uuid, date, date, uuid) from authenticated;
revoke execute on function app.job_for_update(uuid) from authenticated;
revoke execute on function app.import_validate(uuid, text, jsonb) from authenticated;
