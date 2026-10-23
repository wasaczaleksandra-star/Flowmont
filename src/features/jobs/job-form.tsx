import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  Checkbox,
  ChoiceChips,
  Row,
  SectionTitle,
  SelectField,
  TextField,
  useToast,
} from '@/components/ui';
import { useCompany, useSession } from '@/features/session';
import { toUserMessage } from '@/lib/errors';
import { todayWarsaw } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import type { Crew, Job, Measurement, Store } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import {
  jobActions,
  kickNotifications,
  toJobPayload,
  toMeasurementPayload,
  uploadAttachment,
  validateJobInput,
  type JobInput,
  type MeasurementInput,
  type PickedFile,
} from './api';
import { FileErrors, FilePickerButtons, PendingFiles } from './files';
import { DateRangeField } from './range-picker';

const emptyMeasurement = (): MeasurementInput => ({ label: '', width: '', height: '', unit: 'mm', quantity: '1', notes: '' });

function fromJob(job?: Job | null, preset?: { start?: string; end?: string }): JobInput {
  return {
    customer_name: job?.customer_name ?? '',
    customer_phone: job?.customer_phone ?? '',
    street: job?.street ?? '',
    postal_code: job?.postal_code ?? '',
    city: job?.city ?? '',
    description: job?.description ?? '',
    estimated_duration: job?.estimated_duration ?? '',
    access_instructions: job?.access_instructions ?? '',
    notes: job?.notes ?? '',
    requested_start: job?.requested_start ?? preset?.start ?? null,
    requested_end: job?.requested_end ?? preset?.end ?? preset?.start ?? null,
  };
}

function fromMeasurement(m: Measurement): MeasurementInput {
  return {
    id: m.id,
    label: m.label,
    width: m.width == null ? '' : String(m.width),
    height: m.height == null ? '' : String(m.height),
    unit: m.unit,
    quantity: String(m.quantity),
    notes: m.notes ?? '',
  };
}

export function JobForm({
  stores,
  crews,
  job,
  existingMeasurements,
  preset,
}: {
  stores: Store[];
  crews: Crew[];
  job?: Job | null;
  existingMeasurements?: Measurement[];
  preset?: { start?: string; end?: string; storeId?: string };
}) {
  const { companyId, isAdmin, storeIds, canWrite } = useCompany();
  const { user } = useSession();
  const toast = useToast();
  const editing = !!job;
  const pendingOnlyDates = editing && job?.status !== 'pending';

  const myStores = useMemo(() => (isAdmin ? stores : stores.filter((s) => storeIds.includes(s.id))), [stores, isAdmin, storeIds]);
  const [storeId, setStoreId] = useState<string | null>(job?.store_id ?? preset?.storeId ?? (myStores.length === 1 ? myStores[0].id : null));
  const [values, setValues] = useState<JobInput>(() => fromJob(job, preset));
  const [measurements, setMeasurements] = useState<MeasurementInput[]>(() =>
    existingMeasurements?.length ? existingMeasurements.map(fromMeasurement) : [],
  );
  const removedMeasurementIds = useRef<string[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmNow, setConfirmNow] = useState(false);
  const [crewId, setCrewId] = useState<string | null>(crews.find((c) => c.is_default)?.id ?? crews[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof JobInput>(k: K) => (v: JobInput[K]) => setValues((s) => ({ ...s, [k]: v }));
  const setM = (i: number, patch: Partial<MeasurementInput>) => setMeasurements((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  async function syncMeasurements(jobId: string, company: string) {
    const ops: PromiseLike<any>[] = [];
    if (removedMeasurementIds.current.length) {
      ops.push(supabase.from('job_measurements').delete().in('id', removedMeasurementIds.current));
    }
    measurements.forEach((m, i) => {
      const payload = toMeasurementPayload(m, i);
      ops.push(
        m.id
          ? supabase.from('job_measurements').update(payload).eq('id', m.id)
          : supabase.from('job_measurements').insert({ ...payload, job_id: jobId, company_id: company }),
      );
    });
    const results = await Promise.all(ops);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
  }

  async function submit() {
    setServerError(null);
    const e = validateJobInput(values, measurements);
    if (!storeId) e.store = 'Wybierz sklep.';
    setErrors(e);
    if (Object.keys(e).length) {
      setServerError('Popraw zaznaczone pola – wprowadzone dane zostały zachowane.');
      return;
    }
    setBusy(true);
    try {
      if (editing && job) {
        await jobActions.update(job.id, toJobPayload(values));
        await syncMeasurements(job.id, job.company_id);
        toast('Zmiany zapisane.');
        router.replace(`/jobs/${job.id}`);
        return;
      }
      const created = await jobActions.submit(
        storeId!,
        toJobPayload(values),
        measurements.map(toMeasurementPayload),
        isAdmin && confirmNow,
        isAdmin && confirmNow ? crewId : null,
      );
      const failedUploads: string[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          await uploadAttachment(created, files[i], files[i].mimeType.startsWith('image/') ? 'photo' : 'measurement_doc', user!.id, (s) =>
            setProgress((p) => ({ ...p, [i]: s === 'uploading' ? 'Wysyłanie…' : 'Zapisywanie…' })),
          );
          setProgress((p) => ({ ...p, [i]: 'Gotowe' }));
        } catch {
          failedUploads.push(files[i].name);
          setProgress((p) => ({ ...p, [i]: 'Błąd' }));
        }
      }
      kickNotifications();
      if (failedUploads.length) {
        toast(`Zlecenie ${created.reference} utworzone, ale nie wysłano plików: ${failedUploads.join(', ')}. Dodaj je w szczegółach zlecenia.`, 'error');
      } else {
        toast(isAdmin && confirmNow ? `Zlecenie ${created.reference} utworzone i potwierdzone.` : `Zgłoszenie ${created.reference} wysłane do akceptacji.`);
      }
      router.replace(`/jobs/${created.id}`);
    } catch (err) {
      setServerError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.lg }}>
      {!canWrite ? <Banner tone="warning">Konto jest w trybie tylko do odczytu – nie można teraz zapisywać zmian.</Banner> : null}

      <Card>
        <SectionTitle>Sklep i klient</SectionTitle>
        {editing ? (
          <AppText>
            <AppText style={{ fontWeight: '700' }}>Sklep: </AppText>
            {stores.find((s) => s.id === job?.store_id)?.name ?? '—'}
          </AppText>
        ) : myStores.length === 1 && !isAdmin ? (
          <AppText>
            <AppText style={{ fontWeight: '700' }}>Sklep: </AppText>
            {myStores[0].name}
          </AppText>
        ) : (
          <SelectField
            label="Sklep partnerski"
            required
            value={storeId}
            onChange={setStoreId}
            options={myStores.map((s) => ({ value: s.id, label: s.name, description: s.city ?? undefined }))}
            error={errors.store}
          />
        )}
        <View style={styles.cols}>
          <View style={styles.col}>
            <TextField label="Imię i nazwisko klienta" required value={values.customer_name} onChangeText={set('customer_name')} error={errors.customer_name} autoComplete="name" />
          </View>
          <View style={styles.col}>
            <TextField
              label="Telefon klienta"
              value={values.customer_phone}
              onChangeText={set('customer_phone')}
              error={errors.customer_phone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="600 100 200"
            />
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle>Adres montażu</SectionTitle>
        <TextField label="Ulica i numer budynku/lokalu" required value={values.street} onChangeText={set('street')} error={errors.street} autoComplete="street-address" placeholder="np. Lipowa 12/4" />
        <View style={styles.cols}>
          <View style={[styles.col, { maxWidth: 180 }]}>
            <TextField label="Kod pocztowy" required value={values.postal_code} onChangeText={set('postal_code')} error={errors.postal_code} keyboardType="numbers-and-punctuation" placeholder="00-000" autoComplete="postal-code" />
          </View>
          <View style={styles.col}>
            <TextField label="Miejscowość" required value={values.city} onChangeText={set('city')} error={errors.city} />
          </View>
        </View>
        <TextField
          label="Dojazd, parking i wejście"
          value={values.access_instructions}
          onChangeText={set('access_instructions')}
          multiline
          placeholder="np. brama od podwórza, kod 1234, parking pod blokiem, winda do 3 piętra"
        />
      </Card>

      <Card>
        <SectionTitle>Termin</SectionTitle>
        {pendingOnlyDates ? (
          <Banner tone="info">Termin potwierdzonego zlecenia zmienia administrator przyciskiem „Zmień termin” w szczegółach zlecenia.</Banner>
        ) : (
          <DateRangeField
            companyId={companyId}
            label={isAdmin ? 'Termin montażu' : 'Proponowany termin montażu'}
            start={values.requested_start}
            end={values.requested_end}
            onChange={(s, e) => setValues((v) => ({ ...v, requested_start: s, requested_end: e }))}
            error={errors.requested_start ?? errors.requested_end}
            restrictToAvailable={!isAdmin}
            minDate={isAdmin ? undefined : todayWarsaw()}
          />
        )}
        <TextField
          label="Szacowany czas montażu"
          value={values.estimated_duration}
          onChangeText={set('estimated_duration')}
          placeholder="np. 6 godzin, 2 dni"
        />
        {isAdmin && !editing ? (
          <View style={{ gap: space.sm }}>
            <Checkbox label="Od razu potwierdź termin i przypisz ekipę" value={confirmNow} onChange={setConfirmNow} />
            {confirmNow ? (
              <SelectField label="Ekipa" value={crewId} onChange={setCrewId} options={crews.map((c) => ({ value: c.id, label: c.name }))} required />
            ) : null}
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Zakres prac</SectionTitle>
        <TextField
          label="Opis montażu"
          required
          multiline
          value={values.description}
          onChangeText={set('description')}
          error={errors.description}
          placeholder="np. Montaż 3 okien PCV z demontażem starych, parapety wewnętrzne"
        />
        <View style={{ gap: space.sm }}>
          <AppText variant="label">Wymiary</AppText>
          {measurements.length === 0 ? <AppText variant="muted">Dodaj wymiary otworów lub elementów (opcjonalnie).</AppText> : null}
          {measurements.map((m, i) => (
            <View key={m.id ?? `new-${i}`} style={styles.measurement}>
              <Row>
                <AppText style={{ fontWeight: '700', flex: 1 }}>{`Pozycja ${i + 1}`}</AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Usuń pozycję ${i + 1}`}
                  hitSlop={8}
                  onPress={() => {
                    if (m.id) removedMeasurementIds.current.push(m.id);
                    setMeasurements((ms) => ms.filter((_, j) => j !== i));
                  }}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              </Row>
              <TextField label="Nazwa (otwór/element)" required value={m.label} onChangeText={(v) => setM(i, { label: v })} error={errors[`m${i}.label`]} placeholder="np. Okno kuchnia" />
              <View style={styles.cols}>
                <View style={styles.colSmall}>
                  <TextField label="Szerokość" value={m.width} onChangeText={(v) => setM(i, { width: v })} keyboardType="decimal-pad" error={errors[`m${i}.width`]} />
                </View>
                <View style={styles.colSmall}>
                  <TextField label="Wysokość" value={m.height} onChangeText={(v) => setM(i, { height: v })} keyboardType="decimal-pad" error={errors[`m${i}.height`]} />
                </View>
                <View style={styles.colSmall}>
                  <TextField label="Ilość" value={m.quantity} onChangeText={(v) => setM(i, { quantity: v })} keyboardType="number-pad" error={errors[`m${i}.quantity`]} />
                </View>
              </View>
              <ChoiceChips
                label="Jednostka"
                value={m.unit}
                onChange={(v) => setM(i, { unit: v })}
                options={[
                  { value: 'mm', label: 'mm' },
                  { value: 'cm', label: 'cm' },
                  { value: 'm', label: 'm' },
                ]}
              />
              <TextField label="Uwagi do pozycji" value={m.notes} onChangeText={(v) => setM(i, { notes: v })} />
            </View>
          ))}
          <Button title="Dodaj wymiar" icon="add" variant="secondary" compact onPress={() => setMeasurements((ms) => [...ms, emptyMeasurement()])} style={{ alignSelf: 'flex-start' }} />
        </View>
      </Card>

      {!editing ? (
        <Card>
          <SectionTitle>Zdjęcia i dokumenty</SectionTitle>
          <AppText variant="muted">Zdjęcia otworów, karty pomiarowe lub inne dokumenty (maks. 20 MB na plik).</AppText>
          <FilePickerButtons
            onPicked={(picked, errs) => {
              setFiles((f) => [...f, ...picked]);
              setFileErrors(errs);
            }}
          />
          <FileErrors errors={fileErrors} />
          <PendingFiles files={files} progress={progress} onRemove={busy ? undefined : (i) => setFiles((f) => f.filter((_, j) => j !== i))} />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Dodatkowe uwagi</SectionTitle>
        <TextField label="Uwagi (widoczne dla sklepu i ekipy)" value={values.notes} onChangeText={set('notes')} multiline />
      </Card>

      {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
      <Row wrap style={{ justifyContent: 'flex-end' }}>
        <Button title="Anuluj" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Button
          title={editing ? 'Zapisz zmiany' : isAdmin ? (confirmNow ? 'Utwórz i potwierdź' : 'Utwórz zgłoszenie') : 'Wyślij zgłoszenie'}
          icon={editing ? 'save-outline' : 'send'}
          onPress={submit}
          loading={busy}
          disabled={!canWrite}
        />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  col: { flexGrow: 1, flexBasis: 240, flexShrink: 1 },
  colSmall: { flexGrow: 1, flexBasis: 110, flexShrink: 1 },
  measurement: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
});
