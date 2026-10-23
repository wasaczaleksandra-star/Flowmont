import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  KeyValue,
  LoadingState,
  PageHeader,
  Pill,
  Row,
  Screen,
  SectionTitle,
  StatusBadge,
  TextField,
  useToast,
} from '@/components/ui';
import { useCompany, useSession } from '@/features/session';
import { useAsync } from '@/hooks/use-async';
import { diffDays, formatDayCount, formatRange, formatTimestamp, type IsoDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { availableActions, displayRange, STATUS_LABEL, type JobStatus } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import type { Activity, Job } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { fetchCrews, fetchJob, fetchJobDetails, jobActions, kickNotifications, mapsUrl, telUrl, uploadAttachment, type PickedFile } from './api';
import { ReleasedDatesDialog, ScheduleDialog } from './dialogs';
import { AttachmentGrid, FileErrors, FilePickerButtons, PendingFiles } from './files';

const FIELD_LABELS: Record<string, string> = {
  customer_name: 'klient',
  customer_phone: 'telefon',
  street: 'ulica',
  postal_code: 'kod pocztowy',
  city: 'miejscowość',
  description: 'opis',
  estimated_duration: 'czas montażu',
  access_instructions: 'dojazd',
  notes: 'uwagi',
  requested_start: 'termin',
  requested_end: 'termin',
};

export function activityText(a: Activity): string {
  const d = a.details ?? {};
  const range = (s?: string, e?: string) => (s ? formatRange(s, e) : '');
  switch (a.action) {
    case 'created':
      return `Utworzono zgłoszenie na termin ${range(d.start, d.end)}`;
    case 'imported':
      return 'Zaimportowano z pliku';
    case 'updated': {
      const fields = Array.from(new Set(((d.fields as string[]) ?? []).map((f) => FIELD_LABELS[f] ?? f)));
      return `Zmieniono dane zlecenia${fields.length ? `: ${fields.join(', ')}` : ''}`;
    }
    case 'confirmed':
      return `Potwierdzono termin ${range(d.start, d.end)} – ${d.crew_name ?? 'ekipa'}`;
    case 'rejected':
      return `Odrzucono zgłoszenie${d.reason ? ` – powód: ${d.reason}` : ''}`;
    case 'cancelled':
      return `Anulowano${d.reason ? ` – powód: ${d.reason}` : ''}`;
    case 'withdrawn':
      return `Sklep wycofał zgłoszenie${d.reason ? ` – powód: ${d.reason}` : ''}`;
    case 'rescheduled':
      return `Zmieniono termin z ${range(d.from_start, d.from_end)} na ${range(d.to_start, d.to_end)}${d.from_crew !== d.to_crew ? ` (ekipa: ${d.from_crew} → ${d.to_crew})` : ''}`;
    case 'started':
      return 'Rozpoczęto montaż';
    case 'completed':
      return 'Zakończono montaż';
    default:
      return a.action;
  }
}

function Notes({ job, internal, notes, onAdded, canWrite }: { job: Job; internal: boolean; notes: { id: string; body: string; author_name: string; created_at: string }[]; onAdded: () => void; canWrite: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('job_notes').insert({ job_id: job.id, company_id: job.company_id, is_internal: internal, body: text.trim() });
    setBusy(false);
    if (error) return toast(toUserMessage(error), 'error');
    setText('');
    onAdded();
  }
  return (
    <View style={{ gap: space.sm }}>
      {notes.length === 0 ? <AppText variant="muted">Brak notatek.</AppText> : null}
      {notes.map((n) => (
        <View key={n.id} style={[styles.note, internal && { backgroundColor: '#FFF8EC', borderColor: '#F3D9A8' }]}>
          <AppText>{n.body}</AppText>
          <AppText variant="small">{`${n.author_name || 'Użytkownik'} · ${formatTimestamp(n.created_at)}`}</AppText>
        </View>
      ))}
      {canWrite ? (
        <View style={{ gap: space.sm }}>
          <TextField label={internal ? 'Nowa notatka wewnętrzna' : 'Nowa notatka'} value={text} onChangeText={setText} multiline />
          <Button title="Dodaj notatkę" variant="secondary" compact onPress={add} loading={busy} disabled={!text.trim()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
    </View>
  );
}

export function JobDetailScreen({ id }: { id: string }) {
  const { role, storeIds, crewIds, canWrite, isAdmin, companyId } = useCompany();
  const { user } = useSession();
  const toast = useToast();
  const job = useAsync(() => fetchJob(id), [id]);
  const details = useAsync(() => fetchJobDetails(id), [id]);
  const crews = useAsync(() => fetchCrews(companyId), [companyId], isAdmin);
  const [dialog, setDialog] = useState<null | 'confirm' | 'reschedule' | 'reject' | 'cancel' | 'withdraw' | 'start' | 'complete'>(null);
  const [busy, setBusy] = useState(false);
  const [released, setReleased] = useState<{ start: IsoDate; end: IsoDate } | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState<Record<number, string>>({});

  if (job.loading && !job.data) return <LoadingState />;
  if (job.error) return <ErrorState message={job.error} onRetry={job.reload} />;
  if (!job.data) {
    return (
      <Screen>
        <Banner tone="warning" title="Nie znaleziono zlecenia">
          Zlecenie nie istnieje albo nie masz do niego dostępu.
        </Banner>
        <Button title="Wróć do listy zleceń" variant="secondary" onPress={() => router.replace('/jobs')} />
      </Screen>
    );
  }

  const j = job.data;
  const actions = availableActions(j, { role, storeIds, crewIds, canWrite });
  const range = displayRange(j);
  const d = details.data;
  const canAddFiles = canWrite && ['pending', 'confirmed', 'in_progress'].includes(j.status);

  const refresh = () => {
    job.reload();
    details.reload();
  };

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      const res: any = await fn();
      toast(message);
      kickNotifications();
      setDialog(null);
      refresh();
      if (res?.released) setReleased(res.released);
    } catch (e) {
      toast(toUserMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPicked() {
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        setUploading((u) => ({ ...u, [i]: 'Wysyłanie…' }));
        await uploadAttachment(j, files[i], files[i].mimeType.startsWith('image/') ? 'photo' : 'other', user!.id);
        setUploading((u) => ({ ...u, [i]: 'Gotowe' }));
      } catch (e) {
        failed.push(`${files[i].name}: ${toUserMessage(e)}`);
        setUploading((u) => ({ ...u, [i]: 'Błąd' }));
      }
    }
    setFiles([]);
    setUploading({});
    setFileErrors(failed);
    if (!failed.length) toast('Pliki dodane.');
    details.reload();
  }

  return (
    <Screen>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/jobs'))} style={styles.back}>
        <Ionicons name="arrow-back" size={18} color={colors.primary} />
        <AppText style={{ color: colors.primary, fontWeight: '600' }}>Wróć</AppText>
      </Pressable>
      <PageHeader
        title={`${j.reference} · ${j.city}`}
        subtitle={`${j.stores?.name ?? 'Sklep'} · utworzono ${formatTimestamp(j.created_at)}`}
        actions={<StatusBadge status={j.status} />}
      />

      {j.status === 'pending' ? (
        <Banner tone="warning" title={STATUS_LABEL.pending}>
          {isAdmin
            ? 'Sprawdź termin i dostępność ekip, a następnie potwierdź lub odrzuć zgłoszenie.'
            : 'Zgłoszenie czeka na decyzję firmy montażowej. Termin nie jest jeszcze zarezerwowany.'}
        </Banner>
      ) : null}
      {j.status === 'rejected' && j.rejection_reason ? <Banner tone="danger" title="Zgłoszenie odrzucone">{`Powód: ${j.rejection_reason}`}</Banner> : null}
      {j.status === 'cancelled' && j.cancellation_reason ? <Banner tone="info" title="Zlecenie anulowane">{`Powód: ${j.cancellation_reason}`}</Banner> : null}

      {actions.length ? (
        <Row wrap>
          {actions.includes('confirm') ? <Button title="Potwierdź" icon="checkmark-circle-outline" variant="success" onPress={() => setDialog('confirm')} /> : null}
          {actions.includes('reject') ? <Button title="Odrzuć" icon="close-circle-outline" variant="danger" onPress={() => setDialog('reject')} /> : null}
          {actions.includes('start') ? <Button title="Rozpocznij montaż" icon="play-circle-outline" onPress={() => setDialog('start')} /> : null}
          {actions.includes('complete') ? <Button title="Zakończ montaż" icon="checkmark-done-outline" variant="success" onPress={() => setDialog('complete')} /> : null}
          {actions.includes('reschedule') ? <Button title="Zmień termin" icon="calendar-outline" variant="secondary" onPress={() => setDialog('reschedule')} /> : null}
          {actions.includes('edit') ? <Button title="Edytuj" icon="create-outline" variant="secondary" onPress={() => router.push(`/jobs/${j.id}/edit`)} /> : null}
          {actions.includes('withdraw') ? <Button title="Wycofaj zgłoszenie" icon="arrow-undo-outline" variant="danger" onPress={() => setDialog('withdraw')} /> : null}
          {actions.includes('cancel') ? <Button title="Anuluj zlecenie" icon="ban-outline" variant="danger" onPress={() => setDialog('cancel')} /> : null}
        </Row>
      ) : null}

      <View style={styles.columns}>
        <View style={styles.mainCol}>
          <Card>
            <SectionTitle>Termin</SectionTitle>
            <Row wrap gap={space.xl}>
              <KeyValue label={range.confirmed ? 'Potwierdzony termin' : 'Proponowany termin'} value={`${formatRange(range.start, range.end)} (${formatDayCount(diffDays(range.start, range.end) + 1)})`} />
              {range.confirmed && (j.requested_start !== j.confirmed_start || j.requested_end !== j.confirmed_end) ? (
                <KeyValue label="Termin prośby sklepu" value={formatRange(j.requested_start, j.requested_end)} />
              ) : null}
              <KeyValue label="Ekipa" value={j.crews?.name ?? (j.status === 'pending' ? 'Zostanie przypisana przy potwierdzeniu' : null)} />
              <KeyValue label="Szacowany czas" value={j.estimated_duration} />
            </Row>
          </Card>

          <Card>
            <SectionTitle>Klient i adres</SectionTitle>
            <Row wrap gap={space.xl}>
              <KeyValue label="Klient" value={j.customer_name} />
              <KeyValue label="Telefon">
                {j.customer_phone ? (
                  <Pressable accessibilityRole="link" accessibilityLabel={`Zadzwoń: ${j.customer_phone}`} onPress={() => Linking.openURL(telUrl(j.customer_phone!))}>
                    <AppText style={styles.link}>{j.customer_phone}</AppText>
                  </Pressable>
                ) : (
                  <AppText>—</AppText>
                )}
              </KeyValue>
              <KeyValue label="Adres">
                <AppText>{`${j.street}, ${j.postal_code} ${j.city}`}</AppText>
                <Pressable accessibilityRole="link" onPress={() => (Platform.OS === 'web' ? window.open(mapsUrl(j), '_blank', 'noopener') : Linking.openURL(mapsUrl(j)))}>
                  <AppText style={styles.link}>Otwórz w mapach</AppText>
                </Pressable>
              </KeyValue>
            </Row>
            {j.access_instructions ? (
              <View style={styles.important}>
                <Ionicons name="navigate-circle-outline" size={20} color={colors.warningText} />
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontWeight: '700' }}>Dojazd, parking i wejście</AppText>
                  <AppText>{j.access_instructions}</AppText>
                </View>
              </View>
            ) : null}
          </Card>

          <Card>
            <SectionTitle>Zakres prac</SectionTitle>
            <AppText>{j.description}</AppText>
            {j.notes ? <KeyValue label="Uwagi" value={j.notes} /> : null}
            <AppText variant="label">Wymiary</AppText>
            {!d ? (
              <LoadingState />
            ) : d.measurements.length === 0 ? (
              <AppText variant="muted">Brak wymiarów.</AppText>
            ) : (
              <View style={styles.table} accessibilityRole="list">
                <View style={[styles.tr, styles.th]}>
                  <AppText style={[styles.td, { flex: 2, fontWeight: '700' }]}>Pozycja</AppText>
                  <AppText style={[styles.td, { fontWeight: '700' }]}>Szer. × wys.</AppText>
                  <AppText style={[styles.td, { flex: 0.6, fontWeight: '700' }]}>Ilość</AppText>
                </View>
                {d.measurements.map((m) => (
                  <View key={m.id} style={styles.tr}>
                    <View style={[styles.td, { flex: 2 }]}>
                      <AppText style={{ fontWeight: '600' }}>{m.label}</AppText>
                      {m.notes ? <AppText variant="small">{m.notes}</AppText> : null}
                    </View>
                    <AppText style={styles.td}>{m.width || m.height ? `${m.width ?? '?'} × ${m.height ?? '?'} ${m.unit}` : '—'}</AppText>
                    <AppText style={[styles.td, { flex: 0.6 }]}>{`${m.quantity} szt.`}</AppText>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card>
            <SectionTitle>Zdjęcia i załączniki</SectionTitle>
            {d ? (
              <AttachmentGrid attachments={d.attachments} canDelete={(a) => canWrite && (isAdmin || (a.uploaded_by === user?.id && canAddFiles))} onChanged={details.reload} />
            ) : (
              <LoadingState />
            )}
            {canAddFiles ? (
              <View style={{ gap: space.sm }}>
                <FilePickerButtons
                  onPicked={(picked, errs) => {
                    setFiles((f) => [...f, ...picked]);
                    setFileErrors(errs);
                  }}
                />
                <FileErrors errors={fileErrors} />
                <PendingFiles files={files} progress={uploading} onRemove={(i) => setFiles((f) => f.filter((_, x) => x !== i))} />
                {files.length ? <Button title={`Wyślij pliki (${files.length})`} icon="cloud-upload-outline" onPress={uploadPicked} style={{ alignSelf: 'flex-start' }} /> : null}
              </View>
            ) : null}
          </Card>
        </View>

        <View style={styles.sideCol}>
          <Card>
            <SectionTitle>Notatki</SectionTitle>
            {d ? <Notes job={j} internal={false} notes={d.notes.filter((n) => !n.is_internal)} onAdded={details.reload} canWrite={canWrite} /> : <LoadingState />}
          </Card>
          {isAdmin ? (
            <Card>
              <SectionTitle right={<Pill text="Tylko administratorzy" tone="warning" />}>Notatki wewnętrzne</SectionTitle>
              {d ? <Notes job={j} internal notes={d.notes.filter((n) => n.is_internal)} onAdded={details.reload} canWrite={canWrite} /> : <LoadingState />}
            </Card>
          ) : null}
          <Card>
            <SectionTitle>Historia</SectionTitle>
            {d?.activity.map((a) => (
              <View key={a.id} style={styles.activity}>
                <View style={styles.dot} />
                <View style={{ flex: 1 }}>
                  <AppText>{activityText(a)}</AppText>
                  <AppText variant="small">{`${a.actor_name || 'System'} · ${formatTimestamp(a.created_at)}`}</AppText>
                </View>
              </View>
            ))}
          </Card>
        </View>
      </View>

      {isAdmin && crews.data ? (
        <>
          <ScheduleDialog mode="confirm" job={j} crews={crews.data} visible={dialog === 'confirm'} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
          <ScheduleDialog
            mode="reschedule"
            job={j}
            crews={crews.data}
            visible={dialog === 'reschedule'}
            onClose={() => setDialog(null)}
            onDone={(r) => {
              setDialog(null);
              refresh();
              if (r) setReleased(r);
            }}
          />
        </>
      ) : null}
      <ConfirmDialog
        visible={dialog === 'reject'}
        title="Odrzucić zgłoszenie?"
        message={`Sklep otrzyma informację, że zgłoszenie ${j.reference} zostało odrzucone.`}
        confirmLabel="Odrzuć"
        destructive
        reasonLabel="Powód odrzucenia (widoczny dla sklepu)"
        loading={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => run(() => jobActions.reject(j.id, reason), 'Zgłoszenie odrzucone.')}
      />
      <ConfirmDialog
        visible={dialog === 'cancel'}
        title="Anulować zlecenie?"
        message={`Zlecenie ${j.reference} zostanie anulowane, a zarezerwowany termin zwolniony. Sklep i ekipa otrzymają powiadomienie.`}
        confirmLabel="Anuluj zlecenie"
        destructive
        reasonLabel="Powód anulowania (widoczny dla sklepu)"
        loading={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => run(() => jobActions.cancel(j.id, reason), 'Zlecenie anulowane.')}
      />
      <ConfirmDialog
        visible={dialog === 'withdraw'}
        title="Wycofać zgłoszenie?"
        message="Firma montażowa otrzyma informację o wycofaniu zgłoszenia."
        confirmLabel="Wycofaj"
        destructive
        reasonLabel="Powód (opcjonalnie)"
        loading={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => run(() => jobActions.withdraw(j.id, reason), 'Zgłoszenie wycofane.')}
      />
      <ConfirmDialog
        visible={dialog === 'start'}
        title="Rozpocząć montaż?"
        message={`Status zlecenia ${j.reference} zmieni się na „W realizacji”.`}
        confirmLabel="Rozpocznij"
        loading={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => run(() => jobActions.start(j.id), 'Montaż rozpoczęty.')}
      />
      <ConfirmDialog
        visible={dialog === 'complete'}
        title="Zakończyć montaż?"
        message={`Zlecenie ${j.reference} zostanie oznaczone jako zakończone.`}
        confirmLabel="Zakończ"
        loading={busy}
        onClose={() => setDialog(null)}
        onConfirm={() => run(() => jobActions.complete(j.id), 'Montaż zakończony.')}
      />
      <ReleasedDatesDialog released={released} onClose={() => setReleased(null)} />
    </Screen>
  );
}

export function JobRow({ job, showStore = true }: { job: Job; showStore?: boolean }) {
  const r = displayRange(job);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${job.reference}, ${job.city}, ${STATUS_LABEL[job.status]}`}
      onPress={() => router.push(`/jobs/${job.id}`)}
      style={(s) => [styles.jobRow, (s as any).hovered && { backgroundColor: '#F6FAFD' }, (s as any).focused && { borderColor: colors.focus }]}>
        <View style={{ flex: 1, gap: 2, minWidth: 200 }}>
          <Row wrap gap={space.sm}>
            <AppText style={{ fontWeight: '700' }}>{job.reference}</AppText>
            <AppText variant="muted">{`${job.city} · ${job.street}`}</AppText>
          </Row>
          <AppText variant="muted" numberOfLines={1}>
            {`${formatRange(r.start, r.end)}${r.confirmed ? '' : ' (proponowany)'}${showStore && job.stores?.name ? ` · ${job.stores.name}` : ''}${job.crews?.name ? ` · ${job.crews.name}` : ''}`}
          </AppText>
        </View>
        <StatusBadge status={job.status as JobStatus} />
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'flex-start' },
  mainCol: { flexGrow: 2, flexBasis: 480, flexShrink: 1, gap: space.lg, minWidth: 0 },
  sideCol: { flexGrow: 1, flexBasis: 300, flexShrink: 1, gap: space.lg, minWidth: 0 },
  link: { color: colors.primary, textDecorationLine: 'underline', fontWeight: '600' },
  important: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warningBg },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: colors.surfaceAlt },
  td: { flex: 1, padding: space.sm },
  note: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, gap: 4 },
  activity: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.focus, marginTop: 7 },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
