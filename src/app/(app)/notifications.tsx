import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, ChoiceChips, Dialog, EmptyState, ErrorState, LoadingState, PageHeader, Row, Screen, useToast } from '@/components/ui';
import { kickNotifications } from '@/features/jobs/api';
import { AdminOnly } from '@/features/guards';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatTimestamp } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { OutboxRow } from '@/lib/types';
import { space } from '@/theme/tokens';
import { DeliveryStatus, EVENT_LABEL } from '@/features/admin/delivery';

function Notifications() {
  const { companyId } = useCompany();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | OutboxRow['status']>('all');
  const [preview, setPreview] = useState<OutboxRow | null>(null);
  const rows = useAsync(async () => {
    let q = supabase.from('notification_outbox').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(200);
    if (filter !== 'all') q = q.eq('status', filter);
    return (await unwrap(q)) as OutboxRow[];
  }, [companyId, filter]);
  const hasMock = (rows.data ?? []).some((r) => r.status === 'mocked');

  async function retry(r: OutboxRow) {
    const { error } = await supabase.rpc('retry_notification', { p_id: r.id });
    if (error) return toast(toUserMessage(error), 'error');
    kickNotifications();
    toast('Wiadomość ponownie w kolejce.');
    rows.reload();
  }

  return (
    <Screen>
      <PageHeader
        title="Powiadomienia"
        subtitle="Wiadomości e-mail i SMS wysyłane przez Flowmont. Klienci końcowi nie otrzymują powiadomień."
        actions={<Button title="Wyślij oczekujące teraz" variant="secondary" icon="refresh" onPress={() => { kickNotifications(); setTimeout(rows.reload, 2500); }} />}
      />
      {hasMock ? (
        <Banner tone="warning" title="Wysyłka działa w trybie testowym">
          Część wiadomości została tylko zapisana do podglądu, bo dostawca e-mail/SMS nie jest skonfigurowany. Nie zostały dostarczone odbiorcom.
        </Banner>
      ) : null}
      <ChoiceChips
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Wszystkie' },
          { value: 'queued', label: 'W kolejce' },
          { value: 'sent', label: 'Wysłane' },
          { value: 'failed', label: 'Błędy' },
          { value: 'mocked', label: 'Tryb testowy' },
        ]}
      />
      {rows.loading && !rows.data ? <LoadingState /> : null}
      {rows.error ? <ErrorState message={rows.error} onRetry={rows.reload} /> : null}
      {rows.data && rows.data.length === 0 ? <EmptyState title="Brak wiadomości" icon="notifications-off-outline" /> : null}
      <View style={{ gap: space.sm }}>
        {(rows.data ?? []).map((r) => (
          <Card key={r.id} style={{ gap: space.sm }}>
            <Row wrap style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <AppText style={{ fontWeight: '700' }}>{`${EVENT_LABEL[r.event_type] ?? r.event_type} · ${r.channel === 'email' ? 'E-mail' : 'SMS'}`}</AppText>
                <AppText variant="muted">{`${r.recipient_label && r.recipient_label !== r.recipient ? `${r.recipient_label} – ` : ''}${r.recipient} · ${formatTimestamp(r.created_at)}`}</AppText>
              </View>
              <DeliveryStatus status={r.status} />
            </Row>
            {r.status === 'failed' && r.last_error ? <Banner tone="danger">{`Powód: ${r.last_error}. Próby: ${r.attempts}.`}</Banner> : null}
            {r.status === 'queued' && r.last_error ? <AppText variant="small">{`Ponowna próba zaplanowana (ostatni błąd: ${r.last_error}).`}</AppText> : null}
            <Row wrap>
              <Button title="Podgląd treści" variant="ghost" compact onPress={() => setPreview(r)} />
              {r.status === 'failed' ? <Button title="Ponów wysyłkę" variant="secondary" compact icon="refresh" onPress={() => retry(r)} /> : null}
            </Row>
          </Card>
        ))}
      </View>
      <Dialog visible={!!preview} title="Podgląd wiadomości" onClose={() => setPreview(null)}>
        {preview ? (
          <>
            <DeliveryStatus status={preview.status} />
            <AppText variant="label">Do</AppText>
            <AppText>{preview.recipient}</AppText>
            {preview.subject ? (
              <>
                <AppText variant="label">Temat</AppText>
                <AppText>{preview.subject}</AppText>
              </>
            ) : null}
            <AppText variant="label">Treść</AppText>
            <AppText selectable>{preview.body}</AppText>
          </>
        ) : null}
      </Dialog>
    </Screen>
  );
}

export default function NotificationsRoute() {
  return (
    <AdminOnly>
      <Notifications />
    </AdminOnly>
  );
}
