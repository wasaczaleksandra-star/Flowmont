-- Optional scheduling (run once in the Supabase SQL editor AFTER deploying the Edge Functions).
-- Requires the pg_cron and pg_net extensions (Database → Extensions).
-- Replace <PROJECT_REF> and store the service role key in Vault first:
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'flowmont_service_role_key');

-- Deliver queued notifications every minute.
select cron.schedule(
  'flowmont-process-outbox',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/process-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'flowmont_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Mark expired trials once per hour (access itself is computed live; this keeps statuses tidy).
select cron.schedule('flowmont-expire-trials', '17 * * * *', $$ select public.expire_trials(); $$);

-- Public web address used in e-mail links (invitations, job links).
insert into public.app_settings (key, value) values ('app_url', 'https://app.example.pl')
on conflict (key) do update set value = excluded.value;
