// Creates a Stripe Checkout session for a company subscription (test mode during development).
import { corsHeaders, env, json, requireCompanyAdmin, serviceClient } from '../_shared/http.ts';
import { stripeRequest } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const secret = env('STRIPE_SECRET_KEY');
  const appUrl = env('APP_URL');
  if (!secret || !appUrl) {
    return json({ configured: false, error: 'Płatności online nie są jeszcze skonfigurowane.' }, 503);
  }
  if (!secret.startsWith('sk_test_') && env('STRIPE_ALLOW_LIVE') !== 'true') {
    return json({ configured: false, error: 'Tryb płatności na żywo nie został włączony.' }, 503);
  }
  const { company_id: companyId, plan_id: planId } = await req.json().catch(() => ({}));
  if (!companyId || !planId) return json({ error: 'Wybierz plan.' }, 400);
  const auth = await requireCompanyAdmin(req, companyId);
  if ('error' in auth) return auth.error;

  const db = serviceClient();
  const { data: plan } = await db.from('billing_plans').select('*').eq('id', planId).eq('active', true).maybeSingle();
  if (!plan?.provider_price_id) return json({ error: 'Ten plan nie jest dostępny.' }, 400);
  const { data: sub } = await db.from('subscriptions').select('*').eq('company_id', companyId).maybeSingle();
  const { data: company } = await db.from('companies').select('id, name, email').eq('id', companyId).single();

  try {
    let customerId: string | undefined = sub?.provider_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripeRequest<{ id: string }>(secret, 'customers', {
        name: company.name,
        email: company.email ?? auth.user.email ?? '',
        'metadata[company_id]': companyId,
      });
      customerId = customer.id;
      await db.from('subscriptions').upsert({ company_id: companyId, provider: 'stripe', provider_customer_id: customerId });
    }
    const session = await stripeRequest<{ url: string }>(secret, 'checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: companyId,
      'line_items[0][price]': plan.provider_price_id,
      'line_items[0][quantity]': '1',
      'metadata[company_id]': companyId,
      'metadata[plan_id]': plan.id,
      'subscription_data[metadata][company_id]': companyId,
      'subscription_data[metadata][plan_id]': plan.id,
      locale: 'pl',
      success_url: `${appUrl.replace(/\/$/, '')}/billing?status=success`,
      cancel_url: `${appUrl.replace(/\/$/, '')}/billing?status=cancelled`,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: 'Nie udało się rozpocząć płatności. Spróbuj ponownie później.', detail: String(e) }, 502);
  }
});
