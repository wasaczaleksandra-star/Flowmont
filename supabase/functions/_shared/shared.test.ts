import { describe, expect, it, vi } from 'vitest';
import { processOutbox, type OutboxStore } from './processor.ts';
import { adaptersFromEnv, MockAdapter, normalizePolishPhone, ResendEmailAdapter, type DeliveryAdapter, type OutboxMessage } from './providers.ts';
import { billingUpdateFromEvent, hmacSha256Hex, mapStripeStatus, verifyStripeSignature } from './stripe.ts';

const msg = (id: string, channel: 'email' | 'sms' = 'email'): OutboxMessage => ({
  id,
  channel,
  recipient: channel === 'email' ? 'a@example.test' : '600100200',
  subject: 'Temat',
  body: 'Treść',
  attempts: 1,
});

function memoryStore(messages: OutboxMessage[]) {
  const queue = [...messages];
  const finished = new Map<string, string>();
  const store: OutboxStore = {
    async claim(limit) {
      return queue.splice(0, limit);
    },
    async finish(id, result) {
      finished.set(id, result.kind);
    },
  };
  return { store, finished };
}

describe('processOutbox', () => {
  it('never reports mock deliveries as sent', async () => {
    const { store, finished } = memoryStore([msg('1'), msg('2', 'sms')]);
    const lying: DeliveryAdapter = { name: 'mock', isMock: true, send: async () => ({ kind: 'sent', provider: 'mock', providerMessageId: 'x' }) };
    const summary = await processOutbox(store, { email: lying, sms: new MockAdapter('mock-sms') });
    expect(summary).toEqual({ claimed: 2, sent: 0, mocked: 2, failed: 0 });
    expect([...finished.values()]).toEqual(['mocked', 'mocked']);
  });

  it('records provider failures and exceptions as failed without stopping the batch', async () => {
    const { store, finished } = memoryStore([msg('1'), msg('2'), msg('3')]);
    let n = 0;
    const flaky: DeliveryAdapter = {
      name: 'resend',
      isMock: false,
      send: async () => {
        n += 1;
        if (n === 1) throw new Error('network');
        if (n === 2) return { kind: 'failed', provider: 'resend', error: 'HTTP 500' };
        return { kind: 'sent', provider: 'resend', providerMessageId: 'id-3' };
      },
    };
    const summary = await processOutbox(store, { email: flaky, sms: new MockAdapter('mock-sms') });
    expect(summary).toEqual({ claimed: 3, sent: 1, mocked: 0, failed: 2 });
    expect(finished.get('3')).toBe('sent');
  });

  it('processes each claimed message exactly once', async () => {
    const { store } = memoryStore([msg('1'), msg('2')]);
    const send = vi.fn(async () => ({ kind: 'sent' as const, provider: 'resend', providerMessageId: null }));
    const adapter: DeliveryAdapter = { name: 'resend', isMock: false, send };
    await Promise.all([
      processOutbox(store, { email: adapter, sms: adapter }),
      processOutbox(store, { email: adapter, sms: adapter }),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('adapters', () => {
  it('falls back to mock adapters when credentials are missing', () => {
    const a = adaptersFromEnv({ EMAIL_PROVIDER: 'resend', SMS_PROVIDER: 'smsapi' });
    expect(a.email.isMock).toBe(true);
    expect(a.sms.isMock).toBe(true);
    const b = adaptersFromEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'Flowmont <x@y.pl>' });
    expect(b.email.name).toBe('resend');
  });

  it('sends an idempotency key to the e-mail provider', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    const adapter = new ResendEmailAdapter('key', 'Flowmont <x@y.pl>', fetchMock as any);
    const result = await adapter.send(msg('abc'));
    expect(result).toEqual({ kind: 'sent', provider: 'resend', providerMessageId: 'em_1' });
    const init = (fetchMock.mock.calls[0] as any)[1];
    expect(init.headers['Idempotency-Key']).toBe('outbox-abc');
  });

  it('normalises Polish phone numbers', () => {
    expect(normalizePolishPhone('600 100 200')).toBe('+48600100200');
    expect(normalizePolishPhone('+48 600-100-200')).toBe('+48600100200');
    expect(normalizePolishPhone('0048600100200')).toBe('+48600100200');
  });
});

describe('stripe', () => {
  it('verifies webhook signatures and rejects tampering or stale events', async () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const t = 1_700_000_000;
    const sig = await hmacSha256Hex('whsec_test', `${t}.${body}`);
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test', 300, t + 10)).toBe(true);
    expect(await verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, 'whsec_test', 300, t + 10)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, 'other', 300, t + 10)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test', 300, t + 1000)).toBe(false);
    expect(await verifyStripeSignature(body, null, 'whsec_test')).toBe(false);
  });

  it('maps subscription states to access states', () => {
    expect(mapStripeStatus('active')).toBe('active');
    expect(mapStripeStatus('past_due')).toBe('past_due');
    expect(mapStripeStatus('canceled')).toBe('cancelled');
    expect(mapStripeStatus('unpaid')).toBe('cancelled');
    expect(mapStripeStatus('incomplete_expired')).toBe('expired');
    expect(mapStripeStatus('incomplete')).toBeNull();
  });

  it('extracts subscription updates from events', () => {
    const u = billingUpdateFromEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { company_id: 'c1', plan_id: 'p1' }, items: { data: [{ current_period_end: 1_800_000_000 }] } } },
    });
    expect(u).toMatchObject({ companyId: 'c1', status: 'cancelled', subscriptionId: 'sub_1', planId: 'p1' });
    expect(u?.periodEnd).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(billingUpdateFromEvent({ type: 'invoice.created', data: { object: {} } })).toBeNull();
  });
});
