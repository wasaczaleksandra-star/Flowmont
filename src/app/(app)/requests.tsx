import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Row, Screen, StatusBadge, useToast } from '@/components/ui';
import { fetchCrews, JOB_SELECT, jobActions, kickNotifications } from '@/features/jobs/api';
import { ScheduleDialog } from '@/features/jobs/dialogs';
import { AdminOnly } from '@/features/guards';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatRange, formatTimestamp, rangesOverlap } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Job } from '@/lib/types';
import { router } from 'expo-router';
import { space } from '@/theme/tokens';

function Requests() {
  const { companyId, canWrite } = useCompany();
  const toast = useToast();
  const [confirming, setConfirming] = useState<Job | null>(null);
  const [rejecting, setRejecting] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const crews = useAsync(() => fetchCrews(companyId), [companyId]);
  const data = useAsync(async () => {
    const pending = (await unwrap(
      supabase.from('jobs').select(JOB_SELECT).eq('company_id', companyId).eq('status', 'pending').order('requested_start'),
    )) as Job[];
    return pending;
  }, [companyId]);

  const pending = data.data ?? [];
  const overlaps = (j: Job) => pending.filter((o) => o.id !== j.id && rangesOverlap(j.requested_start, j.requested_end, o.requested_start, o.requested_end));

  return (
    <Screen>
      <PageHeader title="Zgłoszenia" subtitle="Zgłoszenia sklepów oczekujące na akceptację. Zgłoszenie nie rezerwuje terminu, dopóki go nie potwierdzisz." />
      {data.loading && !data.data ? <LoadingState /> : null}
      {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : null}
      {data.data && pending.length === 0 ? <EmptyState title="Brak oczekujących zgłoszeń" icon="checkmark-done-outline">Wszystkie zgłoszenia zostały rozpatrzone.</EmptyState> : null}
      <View style={{ gap: space.md }}>
        {pending.map((j) => {
          const o = overlaps(j);
          return (
            <Card key={j.id}>
              <Row wrap style={{ justifyContent: 'space-between' }}>
                <View style={{ gap: 2, flex: 1, minWidth: 220 }}>
                  <AppText variant="subheading">{`${j.reference} · ${j.stores?.name ?? ''}`}</AppText>
                  <AppText>{`${formatRange(j.requested_start, j.requested_end)} · ${j.city}, ${j.street}`}</AppText>
                  <AppText variant="muted" numberOfLines={2}>
                    {j.description}
                  </AppText>
                  <AppText variant="small">{`Zgłoszono ${formatTimestamp(j.created_at)}`}</AppText>
                </View>
                <StatusBadge status={j.status} />
              </Row>
              {o.length ? (
                <Banner tone="warning" title="Nakładające się zgłoszenia">
                  {`W tym terminie czekają też: ${o.map((x) => `${x.reference} (${x.stores?.name ?? ''})`).join(', ')}.`}
                </Banner>
              ) : null}
              <Row wrap>
                <Button title="Potwierdź" icon="checkmark-circle-outline" variant="success" disabled={!canWrite || !crews.data} onPress={() => setConfirming(j)} />
                <Button title="Odrzuć" icon="close-circle-outline" variant="danger" disabled={!canWrite} onPress={() => setRejecting(j)} />
                <Button title="Szczegóły" variant="ghost" onPress={() => router.push(`/jobs/${j.id}`)} />
              </Row>
            </Card>
          );
        })}
      </View>
      {confirming && crews.data ? (
        <ScheduleDialog
          mode="confirm"
          job={confirming}
          crews={crews.data}
          visible
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            data.reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        visible={!!rejecting}
        title="Odrzucić zgłoszenie?"
        message={`Sklep otrzyma informację o odrzuceniu zgłoszenia ${rejecting?.reference ?? ''}.`}
        confirmLabel="Odrzuć"
        destructive
        reasonLabel="Powód odrzucenia (widoczny dla sklepu)"
        loading={busy}
        onClose={() => setRejecting(null)}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          setBusy(true);
          try {
            await jobActions.reject(rejecting.id, reason);
            kickNotifications();
            toast('Zgłoszenie odrzucone.');
            setRejecting(null);
            data.reload();
          } catch (e) {
            toast(toUserMessage(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}

export default function RequestsRoute() {
  return (
    <AdminOnly>
      <Requests />
    </AdminOnly>
  );
}
