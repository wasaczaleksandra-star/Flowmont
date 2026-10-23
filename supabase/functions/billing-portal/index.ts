// Opens the Stripe customer portal (change card, invoices, cancel).
import { corsHeaders, env, json, requireCompanyAdmin, serviceClient } from '../_shared/http.ts';
import { stripeRequest } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const secret = env('STRIPE_SECRET_KEY');
  const appUrl = env('APP_URL');
  if (!secret || !appUrl) {
    return json({ configured: false, error: 'Płatności online nie są jeszcze skonfigurowane.' }, 503);
  }
  const { company_id: companyId } = await req.json().catch(() => ({}));
  const auth = await requireCompanyAdmin(req, companyId);
  if ('error' in auth) return auth.error;
  const { data: sub } = await serviceClient().from('subscriptions').select('provider_customer_id').eq('company_id', companyId).maybeSingle();
  if (!sub?.provider_customer_id) return json({ error: 'Brak aktywnej subskrypcji do zarządzania.' }, 400);
  try {
    const session = await stripeRequest<{ url: string }>(secret, 'billing_portal/sessions', {
      customer: sub.provider_customer_id,
      return_url: `${appUrl.replace(/\/$/, '')}/billing`,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: 'Nie udało się otworzyć panelu płatności.', detail: String(e) }, 502);
  }
});
