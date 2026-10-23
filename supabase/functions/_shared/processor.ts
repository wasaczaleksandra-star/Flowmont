import type { DeliveryAdapter, DeliveryResult, OutboxMessage } from './providers.ts';

/** Database operations the processor needs (implemented with supabase-js in the Edge Function). */
export interface OutboxStore {
  /** Atomically claims due messages (public.claim_outbox – FOR UPDATE SKIP LOCKED). */
  claim(limit: number): Promise<OutboxMessage[]>;
  /** Records the result (public.finish_outbox – never flips a final state). */
  finish(id: string, result: DeliveryResult): Promise<void>;
}

export type ProcessSummary = { claimed: number; sent: number; mocked: number; failed: number };

export async function processOutbox(
  store: OutboxStore,
  adapters: { email: DeliveryAdapter; sms: DeliveryAdapter },
  limit = 20,
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { claimed: 0, sent: 0, mocked: 0, failed: 0 };
  const batch = await store.claim(limit);
  summary.claimed = batch.length;
  for (const message of batch) {
    const adapter = message.channel === 'email' ? adapters.email : adapters.sms;
    let result: DeliveryResult;
    try {
      result = await adapter.send(message);
    } catch (e) {
      result = { kind: 'failed', provider: adapter.name, error: e instanceof Error ? e.message : String(e) };
    }
    // A mock adapter can never report a real delivery.
    if (adapter.isMock && result.kind === 'sent') {
      result = { kind: 'mocked', provider: adapter.name };
    }
    await store.finish(message.id, result);
    summary[result.kind] += 1;
  }
  return summary;
}
