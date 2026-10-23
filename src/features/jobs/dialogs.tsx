import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, DateField, Dialog, SelectField, useToast } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { eachDay, formatDayCount, formatRange, rangesOverlap, type IsoDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { displayRange } from '@/lib/status';
import type { Crew, Job } from '@/lib/types';
import { space } from '@/theme/tokens';
import { fetchAvailability, fetchJobsInRange, jobActions, kickNotifications } from './api';

/** Confirm (pending → confirmed) or reschedule (confirmed/in progress) with crew and dates. */
export function ScheduleDialog({
  mode,
  job,
  crews,
  visible,
  onClose,
  onDone,
}: {
  mode: 'confirm' | 'reschedule';
  job: Job;
  crews: Crew[];
  visible: boolean;
  onClose: () => void;
  onDone: (released: { start: IsoDate; end: IsoDate } | null) => void;
}) {
  const toast = useToast();
  const initial = mode === 'confirm' ? { start: job.requested_start, end: job.requested_end } : displayRange(job);
  const [start, setStart] = useState<IsoDate>(initial.start);
  const [end, setEnd] = useState<IsoDate>(initial.end);
  const [crewId, setCrewId] = useState<string | null>(job.crew_id ?? crews.find((c) => c.is_default)?.id ?? crews[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setStart(initial.start);
      setEnd(initial.end);
      setError(null);
    }
  }

  const validRange = !!start && !!end && end >= start;
  const context = useAsync(
    async () => {
      const [jobs, days] = await Promise.all([fetchJobsInRange(job.company_id, start, end), fetchAvailability(job.company_id, start, end)]);
      return { jobs, days };
    },
    [job.company_id, start, end],
    visible && validRange,
  );

  const others = (context.data?.jobs ?? []).filter((j) => j.id !== job.id);
  const crewConflicts = others.filter(
    (j) => (j.status === 'confirmed' || j.status === 'in_progress') && j.crew_id === crewId && j.confirmed_start && rangesOverlap(start, end, j.confirmed_start, j.confirmed_end!),
  );
  const pendingOverlaps = others.filter((j) => j.status === 'pending' && rangesOverlap(start, end, j.requested_start, j.requested_end));
  const blockedDays = (context.data?.days ?? []).filter((d) => d.blocked);

  async function save() {
    setError(null);
    if (!validRange) return setError('Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.');
    if (!crewId) return setError('Wybierz ekipę.');
    setBusy(true);
    try {
      if (mode === 'confirm') {
        await jobActions.confirm(job.id, crewId, start, end);
        toast(`Zlecenie ${job.reference} potwierdzone.`);
        kickNotifications();
        onDone(null);
      } else {
        const res = await jobActions.reschedule(job.id, start, end, crewId);
        toast(`Termin zlecenia ${job.reference} zmieniony.`);
        kickNotifications();
        onDone(res.released);
      }
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={mode === 'confirm' ? `Potwierdź zlecenie ${job.reference}` : `Zmień termin ${job.reference}`}
      footer={
        <>
          <Button title="Anuluj" variant="secondary" onPress={onClose} />
          <Button title={mode === 'confirm' ? 'Potwierdź' : 'Zapisz nowy termin'} onPress={save} loading={busy} disabled={crewConflicts.length > 0} />
        </>
      }>
      {mode === 'confirm' ? <AppText variant="muted">{`Sklep prosi o termin: ${formatRange(job.requested_start, job.requested_end)}.`}</AppText> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <DateField label="Od" value={start} onChange={(d) => { setStart(d); if (d > end) setEnd(d); }} required />
        <DateField label="Do (włącznie)" value={end} onChange={setEnd} required minDate={start} />
      </View>
      <SelectField
        label="Ekipa"
        required
        value={crewId}
        onChange={setCrewId}
        options={crews.map((c) => ({ value: c.id, label: c.name, description: c.is_default ? 'Ekipa domyślna' : undefined }))}
      />
      {validRange ? <AppText>{`Rezerwacja obejmie: ${formatRange(start, end)} (${formatDayCount(eachDay(start, end).length)}).`}</AppText> : null}
      {crewConflicts.length ? (
        <Banner tone="danger" title="Ekipa jest zajęta">
          {`W tym terminie ekipa ma już: ${crewConflicts.map((j) => j.reference).join(', ')}. Wybierz inną ekipę lub termin.`}
        </Banner>
      ) : null}
      {blockedDays.length ? <Banner tone="warning" title="Zablokowane dni">{`Dni zablokowane w tym zakresie: ${blockedDays.length}. Potwierdzenie zostanie odrzucone.`}</Banner> : null}
      {pendingOverlaps.length ? (
        <Banner tone="warning" title="Inne oczekujące zgłoszenia w tym terminie">
          {`${pendingOverlaps.map((j) => `${j.reference} (${j.stores?.name ?? 'sklep'})`).join(', ')}. Zgłoszenia oczekujące nie rezerwują ekipy.`}
        </Banner>
      ) : null}
      {context.error ? <Banner tone="warning">Nie udało się sprawdzić kolizji – serwer i tak zweryfikuje dostępność przy zapisie.</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Dialog>
  );
}

/** Shown after a cancellation or reschedule frees dates: offers an availability announcement. */
export function ReleasedDatesDialog({ released, onClose }: { released: { start: IsoDate; end: IsoDate } | null; onClose: () => void }) {
  return (
    <Dialog
      visible={!!released}
      title="Zwolnił się termin"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button title="Nie teraz" variant="secondary" onPress={onClose} />
          <Button
            title="Przygotuj ogłoszenie"
            icon="megaphone-outline"
            onPress={() => {
              const r = released!;
              onClose();
              router.push({ pathname: '/announcements', params: { start: r.start, end: r.end } });
            }}
          />
        </>
      }>
      {released ? (
        <AppText>{`Termin ${formatRange(released.start, released.end)} jest znowu wolny. Czy chcesz poinformować wybrane sklepy partnerskie? Ogłoszenie nie rezerwuje terminu – sklepy nadal wysyłają zgłoszenia do akceptacji.`}</AppText>
      ) : null}
    </Dialog>
  );
}
