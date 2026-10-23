// Processes the notification outbox: claims due messages, delivers them through the
// configured adapters and records the result. Safe to run concurrently and repeatedly.
// Triggered by pg_cron (see supabase/cron.example.sql) or by the app after an action.
import { corsHeaders, env, json, serviceClient } from '../_shared/http.ts';
import { processOutbox, type OutboxStore } from '../_shared/processor.ts';
import { adaptersFromEnv, type DeliveryResult, type OutboxMessage } from '../_shared/providers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = serviceClient();
  const store: OutboxStore = {
    async claim(limit) {
      const { data, error } = await db.rpc('claim_outbox', { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as OutboxMessage[];
    },
    async finish(id: string, result: DeliveryResult) {
      const { error } = await db.rpc('finish_outbox', {
        p_id: id,
        p_result: result.kind,
        p_provider: result.provider,
        p_provider_message_id: result.kind === 'sent' ? result.providerMessageId : null,
        p_error: result.kind === 'failed' ? result.error : null,
      });
      if (error) throw new Error(error.message);
    },
  };

  const adapters = adaptersFromEnv({
    EMAIL_PROVIDER: env('EMAIL_PROVIDER'),
    RESEND_API_KEY: env('RESEND_API_KEY'),
    EMAIL_FROM: env('EMAIL_FROM'),
    SMS_PROVIDER: env('SMS_PROVIDER'),
    SMSAPI_TOKEN: env('SMSAPI_TOKEN'),
    SMS_SENDER_NAME: env('SMS_SENDER_NAME'),
    TWILIO_ACCOUNT_SID: env('TWILIO_ACCOUNT_SID'),
    TWILIO_AUTH_TOKEN: env('TWILIO_AUTH_TOKEN'),
    TWILIO_FROM: env('TWILIO_FROM'),
  });

  try {
    const summary = await processOutbox(store, adapters, 25);
    return json({ ...summary, email: adapters.email.name, sms: adapters.sms.name });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
