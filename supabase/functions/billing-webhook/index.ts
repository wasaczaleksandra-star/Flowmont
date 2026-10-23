// Stripe webhook: verifies the signature and applies subscription changes idempotently.
// Deploy with --no-verify-jwt (Stripe does not send a Supabase JWT).
import { env, json, serviceClient } from '../_shared/http.ts';
import { billingUpdateFromEvent, verifyStripeSignature } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook not configured' }, 503);
  const raw = await req.text();
  const valid = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret);
  if (!valid) return json({ error: 'Invalid signature' }, 400);

  const event = JSON.parse(raw);
  const update = billingUpdateFromEvent(event);
  const db = serviceClient();
  let companyId = update?.companyId ?? null;
  if (!companyId && update?.customerId) {
    const { data } = await db.from('subscriptions').select('company_id').eq('provider_customer_id', update.customerId).maybeSingle();
    companyId = data?.company_id ?? null;
  }
  const { error } = await db.rpc('apply_billing_event', {
    p_provider: 'stripe',
    p_event_id: event.id,
    p_event_type: event.type,
    p_company_id: companyId,
    p_payload: event,
    p_status: update?.status ?? null,
    p_plan_id: update?.planId ?? null,
    p_customer_id: update?.customerId ?? null,
    p_subscription_id: update?.subscriptionId ?? null,
    p_period_end: update?.periodEnd ?? null,
    p_cancel_at_period_end: update?.cancelAtPeriodEnd ?? null,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ received: true });
});
