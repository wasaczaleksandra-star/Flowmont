// Replaceable delivery adapters for e-mail and SMS.
// Pure TypeScript (fetch only) so the same code runs in Supabase Edge Functions (Deno)
// and in unit tests (Node).

export type OutboxMessage = {
  id: string;
  channel: 'email' | 'sms';
  recipient: string;
  subject: string | null;
  body: string;
  attempts: number;
};

export type DeliveryResult =
  | { kind: 'sent'; provider: string; providerMessageId: string | null }
  | { kind: 'mocked'; provider: string }
  | { kind: 'failed'; provider: string; error: string };

export interface DeliveryAdapter {
  readonly name: string;
  /** true when the adapter only records messages and never delivers them. */
  readonly isMock: boolean;
  send(message: OutboxMessage): Promise<DeliveryResult>;
}

type Fetch = typeof fetch;

/** Development adapter: stores nothing externally and never claims delivery. */
export class MockAdapter implements DeliveryAdapter {
  readonly isMock = true;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  async send(): Promise<DeliveryResult> {
    return { kind: 'mocked', provider: this.name };
  }
}

/** Resend e-mail API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailAdapter implements DeliveryAdapter {
  readonly name = 'resend';
  readonly isMock = false;
  private apiKey: string;
  private from: string;
  private fetchImpl: Fetch;
  constructor(apiKey: string, from: string, fetchImpl: Fetch = fetch) {
    this.apiKey = apiKey;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send(m: OutboxMessage): Promise<DeliveryResult> {
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Provider-side idempotency: a retry after a crash never sends the message twice.
          'Idempotency-Key': `outbox-${m.id}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: [m.recipient],
          subject: m.subject ?? 'Flowmont',
          text: m.body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        return { kind: 'failed', provider: this.name, error: `HTTP ${res.status}: ${data.message ?? 'błąd dostawcy'}` };
      }
      return { kind: 'sent', provider: this.name, providerMessageId: data.id ?? null };
    } catch (e) {
      return { kind: 'failed', provider: this.name, error: errorText(e) };
    }
  }
}

/** SMSAPI.pl (https://www.smsapi.pl/docs). */
export class SmsapiAdapter implements DeliveryAdapter {
  readonly name = 'smsapi';
  readonly isMock = false;
  private token: string;
  private sender: string | null;
  private fetchImpl: Fetch;
  constructor(token: string, sender: string | null, fetchImpl: Fetch = fetch) {
    this.token = token;
    this.sender = sender;
    this.fetchImpl = fetchImpl;
  }

  async send(m: OutboxMessage): Promise<DeliveryResult> {
    try {
      const params = new URLSearchParams({
        to: normalizePolishPhone(m.recipient),
        message: m.body,
        format: 'json',
        encoding: 'utf-8',
        idx: `outbox-${m.id}`,
        check_idx: '1',
      });
      if (this.sender) params.set('from', this.sender);
      const res = await this.fetchImpl('https://api.smsapi.pl/sms.do', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: number; message?: string; list?: { id: string }[] };
      if (!res.ok || data.error) {
        return { kind: 'failed', provider: this.name, error: `SMSAPI ${data.error ?? res.status}: ${data.message ?? 'błąd dostawcy'}` };
      }
      return { kind: 'sent', provider: this.name, providerMessageId: data.list?.[0]?.id ?? null };
    } catch (e) {
      return { kind: 'failed', provider: this.name, error: errorText(e) };
    }
  }
}

/** Twilio Programmable Messaging. */
export class TwilioSmsAdapter implements DeliveryAdapter {
  readonly name = 'twilio';
  readonly isMock = false;
  private accountSid: string;
  private authToken: string;
  private from: string;
  private fetchImpl: Fetch;
  constructor(accountSid: string, authToken: string, from: string, fetchImpl: Fetch = fetch) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send(m: OutboxMessage): Promise<DeliveryResult> {
    try {
      const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: normalizePolishPhone(m.recipient), From: this.from, Body: m.body }).toString(),
      });
      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) {
        return { kind: 'failed', provider: this.name, error: `HTTP ${res.status}: ${data.message ?? 'błąd dostawcy'}` };
      }
      return { kind: 'sent', provider: this.name, providerMessageId: data.sid ?? null };
    } catch (e) {
      return { kind: 'failed', provider: this.name, error: errorText(e) };
    }
  }
}

/** "600 100 200" -> "+48600100200"; numbers with a country code are kept. */
export function normalizePolishPhone(raw: string): string {
  const digits = raw.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 9) return `+48${digits}`;
  return `+${digits}`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type Env = Record<string, string | undefined>;

/** Builds adapters from environment variables. Missing credentials always fall back to the mock. */
export function adaptersFromEnv(env: Env, fetchImpl: Fetch = fetch): { email: DeliveryAdapter; sms: DeliveryAdapter } {
  const emailProvider = (env.EMAIL_PROVIDER ?? 'mock').toLowerCase();
  const smsProvider = (env.SMS_PROVIDER ?? 'mock').toLowerCase();

  let email: DeliveryAdapter = new MockAdapter('mock-email');
  if (emailProvider === 'resend' && env.RESEND_API_KEY && env.EMAIL_FROM) {
    email = new ResendEmailAdapter(env.RESEND_API_KEY, env.EMAIL_FROM, fetchImpl);
  }

  let sms: DeliveryAdapter = new MockAdapter('mock-sms');
  if (smsProvider === 'smsapi' && env.SMSAPI_TOKEN) {
    sms = new SmsapiAdapter(env.SMSAPI_TOKEN, env.SMS_SENDER_NAME ?? null, fetchImpl);
  } else if (smsProvider === 'twilio' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
    sms = new TwilioSmsAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM, fetchImpl);
  }
  return { email, sms };
}
