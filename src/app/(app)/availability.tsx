import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, LoadingState, PageHeader, Row, Screen, SelectField, TextField, useToast } from '@/components/ui';
import { fetchCrews } from '@/features/jobs/api';
import { AdminOnly } from '@/features/guards';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatRange, todayWarsaw, type IsoDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { AvailabilityBlock } from '@/lib/types';
import { space } from '@/theme/tokens';

function Availability() {
  const { companyId, canWrite } = useCompany();
  const toast = useToast();
  const today = todayWarsaw();
  const [start, setStart] = useState<IsoDate | null>(null);
  const [end, setEnd] = useState<IsoDate | null>(null);
  const [crewId, setCrewId] = useState<string>('all');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<AvailabilityBlock | null>(null);
  const crews = useAsync(() => fetchCrews(companyId, true), [companyId]);
  const blocks = useAsync(
    async () => (await unwrap(supabase.from('availability_blocks').select('*').eq('company_id', companyId).gte('end_date', today).order('start_date'))) as AvailabilityBlock[],
    [companyId, today],
  );

  async function add() {
    setError(null);
    if (!start) return setError('Wybierz datę początkową.');
    const e = end ?? start;
    if (e < start) return setError('Data końcowa nie może być wcześniejsza niż początkowa.');
    setBusy(true);
    const { error } = await supabase.rpc('create_availability_block', {
      p_company_id: companyId,
      p_start: start,
      p_end: e,
      p_crew_id: crewId === 'all' ? null : crewId,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) return setError(toUserMessage(error));
    toast('Termin zablokowany.');
    setStart(null);
    setEnd(null);
    setReason('');
    blocks.reload();
  }

  return (
    <Screen maxWidth={900}>
      <PageHeader title="Dostępność" subtitle="Blokuj dni wolne, urlopy ekip i inne niedostępne okresy. Zablokowanych dni nie można potwierdzić." />
      {canWrite ? (
        <Card>
          <AppText variant="subheading">Nowa blokada</AppText>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Row wrap>
            <DateField label="Od" value={start} onChange={(d) => { setStart(d); if (!end || end < d) setEnd(d); }} required minDate={today} />
            <DateField label="Do (włącznie)" value={end} onChange={setEnd} minDate={start ?? today} />
          </Row>
          <SelectField
            label="Dotyczy"
            value={crewId}
            onChange={setCrewId}
            options={[{ value: 'all', label: 'Cała firma (wszystkie ekipy)' }, ...(crews.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: `Tylko: ${c.name}` }))]}
          />
          <TextField label="Powód (widoczny tylko dla firmy)" value={reason} onChangeText={setReason} placeholder="np. Urlop, święto, szkolenie" />
          <Button title="Zablokuj termin" icon="ban-outline" onPress={add} loading={busy} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}
      {blocks.loading && !blocks.data ? <LoadingState /> : null}
      {blocks.error ? <ErrorState message={blocks.error} onRetry={blocks.reload} /> : null}
      {blocks.data && blocks.data.length === 0 ? <EmptyState title="Brak blokad" icon="calendar-clear-outline">Wszystkie przyszłe dni są dostępne dla ekip.</EmptyState> : null}
      <View style={{ gap: space.sm }}>
        {(blocks.data ?? []).map((b) => (
          <Card key={b.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <AppText style={{ fontWeight: '700' }}>{formatRange(b.start_date, b.end_date)}</AppText>
              <AppText variant="muted">{`${b.crew_id ? crews.data?.find((c) => c.id === b.crew_id)?.name ?? 'Ekipa' : 'Cała firma'}${b.reason ? ` · ${b.reason}` : ''}`}</AppText>
            </View>
            {canWrite ? <Button title="Usuń blokadę" variant="danger" compact onPress={() => setToDelete(b)} /> : null}
          </Card>
        ))}
      </View>
      <ConfirmDialog
        visible={!!toDelete}
        title="Usunąć blokadę?"
        message={toDelete ? `Termin ${formatRange(toDelete.start_date, toDelete.end_date)} stanie się znowu dostępny. Jeśli chcesz, wyślij potem ogłoszenie do sklepów.` : ''}
        confirmLabel="Usuń blokadę"
        destructive
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          const { error } = await supabase.from('availability_blocks').delete().eq('id', toDelete.id);
          setToDelete(null);
          if (error) return toast(toUserMessage(error), 'error');
          toast('Blokada usunięta.');
          blocks.reload();
        }}
      />
    </Screen>
  );
}

export default function AvailabilityRoute() {
  return (
    <AdminOnly>
      <Availability />
    </AdminOnly>
  );
}
