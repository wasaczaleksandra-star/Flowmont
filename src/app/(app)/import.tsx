import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { readSheet } from 'read-excel-file/universal';

import {
  AppText,
  Banner,
  Button,
  Card,
  Checkbox,
  ChoiceChips,
  ConfirmDialog,
  EmptyState,
  LoadingState,
  PageHeader,
  Pill,
  Row,
  Screen,
  SectionTitle,
  SelectField,
  useToast,
} from '@/components/ui';
import { AdminOnly } from '@/features/guards';
import { applyMapping, autoMap, FIELDS, missingRequired, parseCsv, templateCsv, toCsv, type ImportKind } from '@/features/import/parse';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatTimestamp } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { colors, space } from '@/theme/tokens';

type PreviewRow = { row: number; data: Record<string, any>; errors: { field: string; message: string }[]; duplicate: boolean };
type Run = {
  id: string;
  kind: ImportKind;
  file_name: string | null;
  status: 'previewed' | 'committed' | 'discarded';
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  imported_rows: number;
  rows: PreviewRow[];
  created_at: string;
  committed_at: string | null;
};

const KIND_LABEL: Record<ImportKind, string> = { stores: 'Sklepy partnerskie', jobs: 'Zlecenia montażu' };

function downloadText(fileName: string, text: string) {
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    Share.share({ title: fileName, message: text });
  }
}

async function readFile(asset: DocumentPicker.DocumentPickerAsset): Promise<unknown[][]> {
  const name = asset.name.toLowerCase();
  const source: Blob | ArrayBuffer = asset.file ?? (await (await fetch(asset.uri)).arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = source instanceof Blob ? await source.text() : new TextDecoder('utf-8').decode(source);
    return parseCsv(text);
  }
  if (name.endsWith('.xlsx')) {
    const rows = await readSheet(source);
    return (rows as unknown[][]).filter((r) => r.some((v) => v !== null && String(v).trim() !== ''));
  }
  throw new Error('Obsługiwane formaty: .xlsx i .csv. Pliki .xls zapisz najpierw w Excelu jako .xlsx.');
}

function ImportScreen() {
  const { companyId, canWrite } = useCompany();
  const toast = useToast();
  const [kind, setKind] = useState<ImportKind>('stores');
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [notify, setNotify] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<Run | null>(null);
  const history = useAsync(
    async () =>
      (await unwrap(
        supabase.from('import_runs').select('id, kind, file_name, status, total_rows, valid_rows, invalid_rows, duplicate_rows, imported_rows, created_at, committed_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20),
      )) as Run[],
    [companyId],
  );

  function reset() {
    setFileName(null);
    setHeaders([]);
    setDataRows([]);
    setMapping([]);
    setRun(null);
    setError(null);
    setNotify(false);
  }

  async function pick() {
    reset();
    setDone(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if ((asset.size ?? 0) > 5 * 1024 * 1024) return setError('Plik jest za duży (maks. 5 MB).');
    setBusy(true);
    try {
      const rows = await readFile(asset);
      if (rows.length < 2) throw new Error('Plik nie zawiera danych (potrzebny wiersz nagłówków i co najmniej jeden wiersz danych).');
      if (rows.length - 1 > 2000) throw new Error('Plik może zawierać maksymalnie 2000 wierszy danych.');
      const h = rows[0].map((v) => String(v ?? '').trim());
      setFileName(asset.name);
      setHeaders(h);
      setDataRows(rows.slice(1));
      setMapping(autoMap(h, kind));
    } catch (e: any) {
      setError(e?.message ?? 'Nie udało się odczytać pliku.');
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    setError(null);
    const missing = missingRequired(mapping, kind);
    if (missing.length) return setError(`Przypisz wymagane kolumny: ${missing.map((m) => m.label).join(', ')}.`);
    setBusy(true);
    try {
      const rows = applyMapping(dataRows, mapping, kind);
      const r = (await unwrap(supabase.rpc('import_preview', { p_company_id: companyId, p_kind: kind, p_file_name: fileName, p_rows: rows }))) as Run;
      setRun(r);
      history.reload();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!run) return;
    setBusy(true);
    try {
      const r = (await unwrap(supabase.rpc('import_commit', { p_run_id: run.id, p_notify: notify }))) as Run;
      setDone(r);
      setConfirm(false);
      reset();
      history.reload();
      toast(`Zaimportowano ${r.imported_rows} wierszy.`);
    } catch (e) {
      toast(toUserMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  function errorReport() {
    if (!run) return;
    const lines = [['Wiersz', 'Pole', 'Błąd']];
    for (const r of run.rows) for (const e of r.errors) lines.push([String(r.row + 1), e.field, e.message]);
    downloadText(`bledy-importu-${kind}.csv`, toCsv(lines));
  }

  const options = [{ value: '__skip', label: 'Pomiń kolumnę' }, ...FIELDS[kind].map((f) => ({ value: f.key, label: `${f.label}${f.required ? ' *' : ''}` }))];
  const invalid = run?.rows.filter((r) => r.errors.length) ?? [];

  return (
    <Screen maxWidth={960}>
      <PageHeader title="Import z Excela" subtitle="Import sklepów i zleceń z plików .xlsx lub .csv do Twojej firmy. Dane zapisujemy dopiero po Twoim potwierdzeniu." />
      {!canWrite ? <Banner tone="warning">Import jest niedostępny w trybie tylko do odczytu.</Banner> : null}
      {done ? (
        <Banner tone="success" title="Import zakończony">
          {`Zaimportowano ${done.imported_rows} z ${done.total_rows} wierszy (${KIND_LABEL[done.kind]}). Wiersze z błędami i duplikaty zostały pominięte.`}
        </Banner>
      ) : null}

      <Card>
        <SectionTitle>1. Rodzaj danych i szablon</SectionTitle>
        <ChoiceChips<ImportKind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            reset();
          }}
          options={[
            { value: 'stores', label: KIND_LABEL.stores },
            { value: 'jobs', label: KIND_LABEL.jobs },
          ]}
        />
        <AppText variant="muted">
          {kind === 'jobs'
            ? 'Zlecenia przypisujemy do istniejących sklepów po nazwie. Status „potwierdzone” rezerwuje ekipę (domyślną lub wskazaną), o ile jest wolna.'
            : 'Duplikaty wykrywamy po nazwie sklepu i numerze NIP.'}
        </AppText>
        <Button title="Pobierz szablon (CSV dla Excela)" variant="secondary" icon="download-outline" onPress={() => downloadText(`szablon-${kind}.csv`, templateCsv(kind))} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Card>
        <SectionTitle>2. Plik</SectionTitle>
        <Row wrap>
          <Button title={fileName ? 'Wybierz inny plik' : 'Wybierz plik .xlsx lub .csv'} icon="document-outline" onPress={pick} loading={busy && !headers.length} disabled={!canWrite} />
          {fileName ? <AppText>{`${fileName} · ${dataRows.length} wierszy`}</AppText> : null}
        </Row>
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </Card>

      {headers.length && !run ? (
        <Card>
          <SectionTitle>3. Dopasowanie kolumn</SectionTitle>
          <AppText variant="muted">Sprawdź, które kolumny pliku odpowiadają polom Flowmont. Pola oznaczone * są wymagane.</AppText>
          {headers.map((h, i) => (
            <SelectField
              key={`${h}-${i}`}
              label={`Kolumna „${h || `#${i + 1}`}” (np. ${String(dataRows[0]?.[i] ?? '').slice(0, 40) || 'pusta'})`}
              value={mapping[i] ?? '__skip'}
              onChange={(v) => setMapping((m) => m.map((x, j) => (j === i ? (v === '__skip' ? null : v) : x === v ? null : x)))}
              options={options}
            />
          ))}
          <Button title="Sprawdź dane" icon="checkmark-done-outline" onPress={validate} loading={busy} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {run ? (
        <Card>
          <SectionTitle>4. Podgląd i potwierdzenie</SectionTitle>
          <Row wrap>
            <Pill text={`Wszystkie: ${run.total_rows}`} />
            <Pill text={`Poprawne: ${run.valid_rows}`} tone="success" />
            <Pill text={`Błędne: ${run.invalid_rows}`} tone={run.invalid_rows ? 'danger' : 'neutral'} />
            <Pill text={`Duplikaty: ${run.duplicate_rows}`} tone={run.duplicate_rows ? 'warning' : 'neutral'} />
          </Row>
          {invalid.length ? (
            <View style={{ gap: space.xs }}>
              <AppText variant="label">Wiersze do poprawy (zostaną pominięte)</AppText>
              {invalid.slice(0, 50).map((r) => (
                <AppText key={r.row} style={{ color: r.duplicate ? colors.warningText : colors.danger }}>
                  {`Wiersz ${r.row + 1}: ${r.errors.map((e) => e.message).join(' ')}`}
                </AppText>
              ))}
              {invalid.length > 50 ? <AppText variant="muted">{`…i ${invalid.length - 50} więcej – pobierz raport błędów.`}</AppText> : null}
              <Button title="Pobierz raport błędów" variant="secondary" compact icon="download-outline" onPress={errorReport} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : (
            <Banner tone="success">Wszystkie wiersze są poprawne.</Banner>
          )}
          <AppText variant="label">Przykładowe poprawne wiersze</AppText>
          {run.rows
            .filter((r) => !r.errors.length)
            .slice(0, 5)
            .map((r) => (
              <AppText key={r.row} variant="muted">
                {kind === 'stores' ? `${r.data.name}${r.data.city ? `, ${r.data.city}` : ''}` : `${r.data.store_name}: ${r.data.customer_name}, ${r.data.city}, ${r.data.requested_start}`}
              </AppText>
            ))}
          <Checkbox
            label={kind === 'stores' ? 'Po imporcie wyślij zaproszenia na adresy e-mail sklepów' : 'Po imporcie powiadom sklepy o potwierdzonych zleceniach'}
            value={notify}
            onChange={setNotify}
          />
          <AppText variant="small">Domyślnie import nie wysyła żadnych wiadomości.</AppText>
          <Row wrap>
            <Button
              title="Odrzuć"
              variant="secondary"
              onPress={async () => {
                await supabase.rpc('import_discard', { p_run_id: run.id });
                reset();
                history.reload();
              }}
            />
            <Button title={`Importuj ${run.valid_rows} poprawnych wierszy`} icon="cloud-upload-outline" disabled={!run.valid_rows || !canWrite} onPress={() => setConfirm(true)} />
          </Row>
        </Card>
      ) : null}

      <SectionTitle>Historia importów</SectionTitle>
      {history.loading && !history.data ? <LoadingState /> : null}
      {history.data && history.data.length === 0 ? <EmptyState title="Brak importów" icon="time-outline" /> : null}
      <View style={{ gap: space.sm }}>
        {(history.data ?? []).map((h) => (
          <Card key={h.id} style={{ gap: 4 }}>
            <Row wrap style={{ justifyContent: 'space-between' }}>
              <AppText style={{ fontWeight: '700' }}>{`${KIND_LABEL[h.kind]} · ${h.file_name ?? 'plik'}`}</AppText>
              <Pill text={h.status === 'committed' ? 'Zaimportowano' : h.status === 'discarded' ? 'Odrzucono' : 'Podgląd'} tone={h.status === 'committed' ? 'success' : 'neutral'} />
            </Row>
            <AppText variant="muted">
              {`${formatTimestamp(h.created_at)} · wiersze: ${h.total_rows}, poprawne: ${h.valid_rows}, błędne: ${h.invalid_rows}, duplikaty: ${h.duplicate_rows}${h.status === 'committed' ? `, zaimportowane: ${h.imported_rows}` : ''}`}
            </AppText>
          </Card>
        ))}
      </View>

      <ConfirmDialog
        visible={confirm}
        title="Zapisać dane?"
        message={`Do firmy zostanie dodanych ${run?.valid_rows ?? 0} rekordów (${KIND_LABEL[kind].toLowerCase()}). ${notify ? 'Po imporcie zostaną wysłane wiadomości.' : 'Żadne wiadomości nie zostaną wysłane.'}`}
        confirmLabel="Importuj"
        loading={busy}
        onClose={() => setConfirm(false)}
        onConfirm={commit}
      />
    </Screen>
  );
}

export default function ImportRoute() {
  return (
    <AdminOnly>
      <ImportScreen />
    </AdminOnly>
  );
}
