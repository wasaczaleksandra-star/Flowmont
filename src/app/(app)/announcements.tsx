import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DateField,
  Dialog,
  EmptyState,
  IconButton,
  LoadingState,
  MultiChips,
  PageHeader,
  Row,
  Screen,
  SectionTitle,
  TextField,
  useToast,
} from '@/components/ui';
import { fetchAvailability, fetchStores, kickNotifications } from '@/features/jobs/api';
import { AdminOnly } from '@/features/guards';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { eachDay, formatDateLong, formatDateNoYear, formatTimestamp, isIsoDate, todayWarsaw, type IsoDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { OutboxRow } from '@/lib/types';
import { space } from '@/theme/tokens';
import { DeliveryStatus } from '@/features/admin/delivery';

function defaultMessage(dates: IsoDate[]) {
  if (dates.length === 0) return '';
  const list = dates.map(formatDateNoYear);
  const text = list.length === 1 ? `na ${list[0]}` : `na dni: ${list.join(', ')}`;
  return `Zwolnił się termin montażu ${text}. Sprawdź dostępność i zgłoś zlecenie w Flowmont.`;
}

type Recipient = { store_id: string; store_name: string; channel: 'email' | 'sms'; recipient: string };

function Announcements() {
  const { companyId, canWrite } = useCompany();
  const toast = useToast();
  const params = useLocalSearchParams<{ start?: string; end?: string }>();
  const today = todayWarsaw();
  const initialDates =
    isIsoDate(params.start) && isIsoDate(params.end ?? params.start) ? eachDay(params.start!, (params.end as string) ?? params.start!).filter((d) => d >= today).slice(0, 31) : [];
  const [dates, setDates] = useState<IsoDate[]>(initialDates);
  const [newDate, setNewDate] = useState<IsoDate | null>(null);
  const [message, setMessage] = useState(defaultMessage(initialDates));
  const [touched, setTouched] = useState(false);
  const [allStores, setAllStores] = useState(true);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ id: string; recipients: Recipient[] } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [results, setResults] = useState<string | null>(null);

  const stores = useAsync(() => fetchStores(companyId), [companyId]);
  const availability = useAsync(
    () => (dates.length ? fetchAvailability(companyId, dates[0], dates[dates.length - 1]) : Promise.resolve([])),
    [companyId, dates.join(',')],
  );
  const history = useAsync(async () => {
    const anns = (await unwrap(supabase.from('announcements').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20))) as any[];
    const ids = anns.map((a) => a.id);
    const outbox = ids.length
      ? ((await unwrap(supabase.from('notification_outbox').select('id, announcement_id, status, recipient, channel').in('announcement_id', ids))) as OutboxRow[])
      : [];
    return anns.map((a) => ({ ...a, messages: outbox.filter((o) => o.announcement_id === a.id) }));
  }, [companyId]);

  const busyDates = (availability.data ?? []).filter((a) => dates.includes(a.day) && a.status !== 'available' && a.status !== 'partial');

  function setDatesAndMessage(next: IsoDate[]) {
    const sorted = Array.from(new Set(next)).sort();
    setDates(sorted);
    if (!touched) setMessage(defaultMessage(sorted));
  }

  async function prepare() {
    setError(null);
    if (!dates.length) return setError('Dodaj co najmniej jeden termin.');
    if (!allStores && !storeIds.length) return setError('Wybierz sklepy albo zaznacz „Wszystkie aktywne sklepy”.');
    if (!email && !sms) return setError('Wybierz kanał: e-mail, SMS lub oba.');
    setBusy(true);
    try {
      const ann = (await unwrap(
        supabase.rpc('create_announcement', {
          p_company_id: companyId,
          p_dates: dates,
          p_store_ids: allStores ? null : storeIds,
          p_message: message,
          p_send_email: email,
          p_send_sms: sms,
        }),
      )) as { id: string };
      const recipients = (await unwrap(supabase.rpc('preview_announcement', { p_announcement_id: ann.id }))) as Recipient[];
      setDraft({ id: ann.id, recipients });
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!draft) return;
    setBusy(true);
    try {
      const count = (await unwrap(supabase.rpc('send_announcement', { p_announcement_id: draft.id }))) as number;
      kickNotifications();
      setResults(`Ogłoszenie przekazano do wysyłki: ${count} wiadomości.`);
      toast('Ogłoszenie wysłane do kolejki.');
      setDraft(null);
      setConfirmSend(false);
      history.reload();
      setTimeout(history.reload, 3000);
    } catch (e) {
      toast(toUserMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen maxWidth={900}>
      <PageHeader title="Ogłoszenia o wolnych terminach" subtitle="Poinformuj wybrane sklepy o zwolnionym terminie. Ogłoszenie nie rezerwuje terminu – sklepy nadal wysyłają zgłoszenia do akceptacji." />
      {results ? <Banner tone="success">{results}</Banner> : null}
      {canWrite ? (
        <Card>
          <SectionTitle>Nowe ogłoszenie</SectionTitle>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <AppText variant="label">Terminy</AppText>
          {dates.length === 0 ? <AppText variant="muted">Nie wybrano terminów.</AppText> : null}
          {dates.map((d) => (
            <Row key={d} style={{ justifyContent: 'space-between' }}>
              <AppText>{formatDateLong(d)}</AppText>
              <IconButton icon="close" label={`Usuń ${formatDateLong(d)}`} onPress={() => setDatesAndMessage(dates.filter((x) => x !== d))} />
            </Row>
          ))}
          <Row wrap style={{ alignItems: 'flex-end' }}>
            <DateField label="Dodaj dzień" value={newDate} onChange={setNewDate} minDate={today} />
            <Button title="Dodaj" variant="secondary" onPress={() => { if (newDate) { setDatesAndMessage([...dates, newDate]); setNewDate(null); } }} disabled={!newDate} />
          </Row>
          {busyDates.length ? (
            <Banner tone="warning">{`Uwaga: w dniach ${busyDates.map((d) => formatDateNoYear(d.day)).join(', ')} nie ma wolnych ekip lub są zablokowane.`}</Banner>
          ) : null}
          <TextField
            label="Treść wiadomości"
            value={message}
            onChangeText={(v) => {
              setTouched(true);
              setMessage(v);
            }}
            multiline
            hint={`${message.length} znaków${sms && message.length > 150 ? ' – długi SMS może zostać podzielony na kilka części' : ''}`}
          />
          <Checkbox label="Wszystkie aktywne sklepy" value={allStores} onChange={setAllStores} />
          {!allStores ? (
            stores.data ? (
              <MultiChips label="Wybrane sklepy" values={storeIds} onChange={setStoreIds} options={stores.data.map((s) => ({ value: s.id, label: s.name }))} />
            ) : (
              <LoadingState />
            )
          ) : null}
          <Row wrap>
            <Checkbox label="E-mail" value={email} onChange={setEmail} />
            <Checkbox label="SMS" value={sms} onChange={setSms} />
          </Row>
          <Button title="Podgląd i odbiorcy" icon="eye-outline" onPress={prepare} loading={busy} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      <SectionTitle>Wysłane ogłoszenia</SectionTitle>
      {history.loading && !history.data ? <LoadingState /> : null}
      {history.data && history.data.filter((a) => a.sent_at).length === 0 ? <EmptyState title="Brak wysłanych ogłoszeń" icon="megaphone-outline" /> : null}
      <View style={{ gap: space.sm }}>
        {(history.data ?? [])
          .filter((a) => a.sent_at)
          .map((a) => {
            const counts = a.messages.reduce((acc: Record<string, number>, m: OutboxRow) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});
            return (
              <Card key={a.id}>
                <AppText style={{ fontWeight: '700' }}>{(a.dates as string[]).map(formatDateNoYear).join(', ')}</AppText>
                <AppText variant="muted">{`Wysłano ${formatTimestamp(a.sent_at)} · wiadomości: ${a.messages.length}`}</AppText>
                <AppText numberOfLines={3}>{a.message}</AppText>
                <Row wrap>
                  {Object.entries(counts).map(([status, n]) => (
                    <Row key={status} gap={4}>
                      <DeliveryStatus status={status as OutboxRow['status']} />
                      <AppText variant="small">{`× ${n}`}</AppText>
                    </Row>
                  ))}
                </Row>
              </Card>
            );
          })}
      </View>

      <Dialog
        visible={!!draft}
        title="Podgląd ogłoszenia"
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button title="Wróć do edycji" variant="secondary" onPress={() => setDraft(null)} />
            <Button title="Wyślij" icon="send" disabled={!draft?.recipients.length} onPress={() => setConfirmSend(true)} />
          </>
        }>
        <AppText variant="label">Treść</AppText>
        <Card style={{ backgroundColor: '#F6FAFD' }}>
          <AppText>{message}</AppText>
        </Card>
        <AppText variant="label">{`Odbiorcy (${draft?.recipients.length ?? 0})`}</AppText>
        {draft && draft.recipients.length === 0 ? (
          <Banner tone="warning">Wybrane sklepy nie mają adresu e-mail/telefonu ani użytkowników z włączonymi powiadomieniami.</Banner>
        ) : null}
        {draft?.recipients.map((r, i) => (
          <AppText key={i}>{`${r.store_name} – ${r.channel === 'email' ? 'e-mail' : 'SMS'}: ${r.recipient}`}</AppText>
        ))}
      </Dialog>
      <ConfirmDialog
        visible={confirmSend}
        title="Wysłać ogłoszenie?"
        message={`Wiadomość trafi do ${draft?.recipients.length ?? 0} odbiorców. Ogłoszenie można wysłać tylko raz.`}
        confirmLabel="Wyślij teraz"
        loading={busy}
        onClose={() => setConfirmSend(false)}
        onConfirm={send}
      />
    </Screen>
  );
}

export default function AnnouncementsRoute() {
  return (
    <AdminOnly>
      <Announcements />
    </AdminOnly>
  );
}
