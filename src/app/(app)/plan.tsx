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
  DateField,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Row,
  Screen,
  SelectField,
  StatusBadge,
  useToast,
} from '@/components/ui';
import { fetchCrews, JOB_SELECT, jobActions, kickNotifications, mapsUrl, telUrl } from '@/features/jobs/api';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { addDays, diffDays, formatDateLong, todayWarsaw, type IsoDate } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { availableActions } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import type { Job } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

export default function DailyPlan() {
  const { companyId, isAdmin, role, storeIds, crewIds, canWrite } = useCompany();
  const toast = useToast();
  const [date, setDate] = useState<IsoDate>(todayWarsaw());
  const [crewId, setCrewId] = useState('any');
  const [action, setAction] = useState<{ job: Job; kind: 'start' | 'complete' } | null>(null);
  const [busy, setBusy] = useState(false);
  const crews = useAsync(() => fetchCrews(companyId, true), [companyId]);

  const data = useAsync(async () => {
    const [jobs, positions] = await Promise.all([
      unwrap(
        supabase
          .from('jobs')
          .select(JOB_SELECT)
          .eq('company_id', companyId)
          .in('status', ['confirmed', 'in_progress', 'completed'])
          .lte('confirmed_start', date)
          .gte('confirmed_end', date),
      ),
      unwrap(supabase.from('plan_positions').select('job_id, position').eq('company_id', companyId).eq('plan_date', date)),
    ]);
    const pos = new Map((positions as { job_id: string; position: number }[]).map((p) => [p.job_id, p.position]));
    return (jobs as Job[]).sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999) || a.reference.localeCompare(b.reference));
  }, [companyId, date]);

  const jobs = (data.data ?? []).filter((j) => crewId === 'any' || j.crew_id === crewId);

  async function move(index: number, dir: -1 | 1) {
    const list = [...(data.data ?? [])];
    const visible = jobs.map((j) => j.id);
    const a = list.findIndex((j) => j.id === visible[index]);
    const b = list.findIndex((j) => j.id === visible[index + dir]);
    if (a < 0 || b < 0) return;
    [list[a], list[b]] = [list[b], list[a]];
    data.setData(list);
    const { error } = await supabase.rpc('set_plan_order', { p_company_id: companyId, p_date: date, p_job_ids: list.map((j) => j.id) });
    if (error) {
      toast(toUserMessage(error), 'error');
      data.reload();
    }
  }

  return (
    <Screen maxWidth={900}>
      <PageHeader title="Plan dnia" subtitle={formatDateLong(date)} />
      <Card style={{ gap: space.md }}>
        <Row wrap>
          <IconButton icon="chevron-back" label="Poprzedni dzień" onPress={() => setDate(addDays(date, -1))} />
          <Button title="Dziś" compact variant="secondary" onPress={() => setDate(todayWarsaw())} />
          <IconButton icon="chevron-forward" label="Następny dzień" onPress={() => setDate(addDays(date, 1))} />
          <View style={{ flexGrow: 1, minWidth: 180 }}>
            <DateField label="Data" value={date} onChange={setDate} />
          </View>
        </Row>
        {role !== 'crew_member' || crewIds.length > 1 ? (
          <SelectField
            label="Ekipa"
            value={crewId}
            onChange={setCrewId}
            options={[{ value: 'any', label: 'Wszystkie ekipy' }, ...(crews.data ?? []).filter((c) => isAdmin || crewIds.includes(c.id)).map((c) => ({ value: c.id, label: c.name }))]}
          />
        ) : null}
      </Card>

      {data.loading && !data.data ? <LoadingState /> : null}
      {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : null}
      {data.data && jobs.length === 0 ? <EmptyState title="Brak montaży w tym dniu" icon="sunny-outline">Wybierz inny dzień lub ekipę.</EmptyState> : null}

      <View style={{ gap: space.md }}>
        {jobs.map((j, i) => {
          const acts = availableActions(j, { role, storeIds, crewIds, canWrite });
          const total = diffDays(j.confirmed_start!, j.confirmed_end!) + 1;
          const dayNo = diffDays(j.confirmed_start!, date) + 1;
          return (
            <Card key={j.id}>
              <Row style={{ alignItems: 'flex-start' }}>
                <View style={styles.order}>
                  <AppText style={{ color: '#fff', fontWeight: '800' }}>{i + 1}</AppText>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="subheading">{j.customer_name}</AppText>
                  <AppText variant="muted">{`${j.reference} · ${j.stores?.name ?? ''} · ${j.crews?.name ?? ''}${total > 1 ? ` · dzień ${dayNo} z ${total}` : ''}`}</AppText>
                </View>
                {isAdmin && canWrite ? (
                  <View>
                    <IconButton icon="arrow-up" label="Przesuń wyżej" disabled={i === 0} onPress={() => move(i, -1)} />
                    <IconButton icon="arrow-down" label="Przesuń niżej" disabled={i === jobs.length - 1} onPress={() => move(i, 1)} />
                  </View>
                ) : null}
              </Row>
              <StatusBadge status={j.status} />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Nawiguj: ${j.street}, ${j.city}`}
                onPress={() => (Platform.OS === 'web' ? window.open(mapsUrl(j), '_blank', 'noopener') : Linking.openURL(mapsUrl(j)))}
                style={styles.line}>
                <Ionicons name="location-outline" size={20} color={colors.primary} />
                <AppText style={styles.link}>{`${j.street}, ${j.postal_code} ${j.city}`}</AppText>
              </Pressable>
              {j.customer_phone ? (
                <Pressable accessibilityRole="link" accessibilityLabel={`Zadzwoń do klienta: ${j.customer_phone}`} onPress={() => Linking.openURL(telUrl(j.customer_phone!))} style={styles.line}>
                  <Ionicons name="call-outline" size={20} color={colors.primary} />
                  <AppText style={styles.link}>{j.customer_phone}</AppText>
                </Pressable>
              ) : null}
              {j.access_instructions ? (
                <Banner tone="warning" title="Ważne – dojazd i wejście">
                  {j.access_instructions}
                </Banner>
              ) : null}
              <AppText>{j.description}</AppText>
              {j.estimated_duration ? <AppText variant="muted">{`Szacowany czas: ${j.estimated_duration}`}</AppText> : null}
              <Row wrap>
                <Button title="Wymiary, zdjęcia i pliki" icon="images-outline" variant="secondary" onPress={() => router.push(`/jobs/${j.id}`)} />
                {acts.includes('start') ? <Button title="Rozpocznij" icon="play-circle-outline" onPress={() => setAction({ job: j, kind: 'start' })} /> : null}
                {acts.includes('complete') ? <Button title="Zakończ" icon="checkmark-done-outline" variant="success" onPress={() => setAction({ job: j, kind: 'complete' })} /> : null}
              </Row>
            </Card>
          );
        })}
      </View>
      <ConfirmDialog
        visible={!!action}
        title={action?.kind === 'start' ? 'Rozpocząć montaż?' : 'Zakończyć montaż?'}
        message={action ? `${action.job.reference} – ${action.job.customer_name}` : ''}
        confirmLabel={action?.kind === 'start' ? 'Rozpocznij' : 'Zakończ'}
        loading={busy}
        onClose={() => setAction(null)}
        onConfirm={async () => {
          if (!action) return;
          setBusy(true);
          try {
            if (action.kind === 'start') await jobActions.start(action.job.id);
            else await jobActions.complete(action.job.id);
            kickNotifications();
            toast(action.kind === 'start' ? 'Montaż rozpoczęty.' : 'Montaż zakończony.');
            setAction(null);
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

const styles = StyleSheet.create({
  order: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  link: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline', flex: 1 },
});
