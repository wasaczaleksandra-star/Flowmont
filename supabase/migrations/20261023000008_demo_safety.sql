-- Demo companies (is_demo = true) contain only fictional data and must never contact anyone.
-- Their messages are stored for preview with status 'mocked' and are never claimed for delivery.
-- is_demo can only be set with the service role / SQL (clients have no update grant on it).

create or replace function app.enqueue(
  p_company uuid, p_event text, p_channel public.notification_channel, p_recipient text, p_label text,
  p_subject text, p_body text, p_key text, p_job uuid default null, p_announcement uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_demo boolean;
begin
  if app.notifications_suppressed() then
    return;
  end if;
  select is_demo into v_demo from public.companies where id = p_company;
  insert into public.notification_outbox
    (company_id, event_type, channel, recipient, recipient_label, subject, body, idempotency_key, job_id, announcement_id,
     status, provider, processed_at)
  values
    (p_company, p_event, p_channel, trim(p_recipient), p_label, p_subject, p_body, p_key, p_job, p_announcement,
     case when coalesce(v_demo, false) then 'mocked'::public.delivery_status else 'queued'::public.delivery_status end,
     case when coalesce(v_demo, false) then 'demo' end,
     case when coalesce(v_demo, false) then now() end)
  on conflict (idempotency_key) do nothing;
end $$;

revoke execute on function app.enqueue(uuid, text, public.notification_channel, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
