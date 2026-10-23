// Minimal Stripe helpers without the SDK (fetch + Web Crypto), usable in Deno and Node tests.

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

/** Maps Stripe subscription statuses to Flowmont statuses (access rules: see docs/BILLING.md). */
export function mapStripeStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
    case 'canceled':
    case 'paused':
      return 'cancelled';
    case 'incomplete_expired':
      return 'expired';
    case 'incomplete':
      return null; // payment not finished yet – keep the current state
    default:
      return null;
  }
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

/**
 * Verifies the Stripe-Signature header (scheme v1) for the raw request body.
 * https://docs.stripe.com/webhooks#verify-manually
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((s) => timingSafeEqual(s, expected));
}

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
};

export type BillingUpdate = {
  companyId: string | null;
  status: SubscriptionStatus | null;
  planId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
};

/** Extracts the subscription update carried by a webhook event (null when irrelevant). */
export function billingUpdateFromEvent(event: { type: string; data: { object: any } }): BillingUpdate | null {
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed') {
    return {
      companyId: obj.client_reference_id ?? obj.metadata?.company_id ?? null,
      status: null,
      planId: obj.metadata?.plan_id ?? null,
      customerId: obj.customer ?? null,
      subscriptionId: obj.subscription ?? null,
      periodEnd: null,
      cancelAtPeriodEnd: null,
    };
  }
  if (event.type.startsWith('customer.subscription.')) {
    const sub = obj as StripeSubscription;
    const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
    return {
      companyId: sub.metadata?.company_id ?? null,
      status: event.type === 'customer.subscription.deleted' ? 'cancelled' : mapStripeStatus(sub.status),
      planId: sub.metadata?.plan_id ?? null,
      customerId: sub.customer ?? null,
      subscriptionId: sub.id,
      periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? null,
    };
  }
  return null;
}

/** POST to the Stripe API with form encoding. */
export async function stripeRequest<T>(
  secretKey: string,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe HTTP ${res.status}`);
  }
  return data as T;
}
