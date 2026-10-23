import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  ChoiceChips,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  MultiChips,
  PageHeader,
  Row,
  Screen,
  SelectField,
} from '@/components/ui';
import { fetchAvailability, fetchBlocks, fetchCrews, fetchJobsInRange, fetchStores } from '@/features/jobs/api';
import { JobRow } from '@/features/jobs/job-detail';
import { useCompany } from '@/features/session';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import {
  addDays,
  addMonths,
  diffDays,
  eachDay,
  formatDateLong,
  formatDateNoYear,
  formatMonthTitle,
  formatRange,
  inRange,
  monthGrid,
  startOfMonth,
  startOfWeek,
  todayWarsaw,
  WEEKDAYS_SHORT,
  type IsoDate,
} from '@/lib/dates';
import { ALL_STATUSES, displayRange, STATUS_LABEL, type JobStatus } from '@/lib/status';
import type { AvailabilityBlock, AvailabilityDay, Job } from '@/lib/types';
import { availabilityColors, colors, font, radius, space, statusColors } from '@/theme/tokens';

type View_ = 'month' | 'week' | 'day' | 'agenda';

const SHORT_STATUS: Record<JobStatus, string> = {
  pending: 'Oczekuje',
  confirmed: 'Potwierdzone',
  in_progress: 'W realizacji',
  completed: 'Zakończone',
  rejected: 'Odrzucone',
  cancelled: 'Anulowane',
};

function windowFor(view: View_, cursor: IsoDate): { from: IsoDate; to: IsoDate } {
  if (view === 'month') {
    const g = monthGrid(cursor);
    return { from: g[0], to: g[41] };
  }
  if (view === 'week') {
    const s = startOfWeek(cursor);
    return { from: s, to: addDays(s, 6) };
  }
  if (view === 'day') return { from: cursor, to: cursor };
  return { from: cursor, to: addDays(cursor, 29) };
}

function EventChip({ job, day, compact }: { job: Job; day: IsoDate; compact?: boolean }) {
  const c = statusColors[job.status];
  const r = displayRange(job);
  const total = diffDays(r.start, r.end) + 1;
  const index = diffDays(r.start, day) + 1;
  const pending = job.status === 'pending';
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${job.reference}, ${STATUS_LABEL[job.status]}, ${job.city}${total > 1 ? `, dzień ${index} z ${total}` : ''}`}
      onPress={() => router.push(`/jobs/${job.id}`)}
      style={(s) => [
        styles.chip,
        { backgroundColor: c.bg, borderColor: c.border, borderStyle: pending ? 'dashed' : 'solid', borderLeftWidth: 4 },
        (s as any).hovered && { opacity: 0.85 },
        (s as any).focused && { borderColor: colors.focus },
      ]}>
      <Text style={[styles.chipText, { color: c.text }]} numberOfLines={1}>
        {`${job.city} · ${job.reference.slice(-4)}`}
      </Text>
      {!compact ? (
        <Text style={[styles.chipSub, { color: c.text }]} numberOfLines={1}>
          {`${SHORT_STATUS[job.status]}${total > 1 ? ` · ${index}/${total}` : ''}${job.crews?.name ? ` · ${job.crews.name}` : ''}`}
        </Text>
      ) : (
        <Text style={[styles.chipSub, { color: c.text }]} numberOfLines={1}>
          {SHORT_STATUS[job.status]}
        </Text>
      )}
    </Pressable>
  );
}

function AvailabilityTag({ a }: { a?: AvailabilityDay }) {
  if (!a) return null;
  const label =
    a.status === 'blocked'
      ? 'Zablokowany'
      : a.status === 'full'
        ? 'Brak wolnych ekip'
        : a.status === 'partial'
          ? `Wolne ekipy: ${a.total_crews - a.busy_crews} z ${a.total_crews}`
          : 'Wolny termin';
  return (
    <View style={[styles.availTag, { backgroundColor: a.status === 'available' ? colors.successBg : availabilityColors[a.status].bg }]}>
      <Text style={[styles.availText, a.status === 'available' && { color: colors.success }]}>{label}</Text>
    </View>
  );
}

export function CalendarScreen() {
  const { companyId, role, isAdmin, canWrite } = useCompany();
  const { isWide, isMedium } = useLayout();
  const today = todayWarsaw();
  const [view, setView] = useState<View_>(isWide ? 'month' : 'agenda');
  const [cursor, setCursor] = useState<IsoDate>(today);
  const [storeFilter, setStoreFilter] = useState('any');
  const [crewFilter, setCrewFilter] = useState('any');
  const [statusFilter, setStatusFilter] = useState<JobStatus[]>(['pending', 'confirmed', 'in_progress', 'completed']);
  const [selStart, setSelStart] = useState<IsoDate | null>(null);
  const [selEnd, setSelEnd] = useState<IsoDate | null>(null);
  const isStore = role === 'store_user';
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = (storeFilter !== 'any' ? 1 : 0) + (crewFilter !== 'any' ? 1 : 0) + (statusFilter.length !== 4 ? 1 : 0);

  const win = windowFor(view, view === 'month' ? startOfMonth(cursor) : cursor);
  const data = useAsync(async () => {
    const [jobs, availability, blocks] = await Promise.all([
      fetchJobsInRange(companyId, win.from, win.to),
      fetchAvailability(companyId, win.from, win.to),
      isStore ? Promise.resolve([] as AvailabilityBlock[]) : fetchBlocks(companyId, win.from, win.to),
    ]);
    return { jobs, availability, blocks };
  }, [companyId, win.from, win.to, isStore]);
  const stores = useAsync(() => fetchStores(companyId, true), [companyId], isAdmin);
  const crews = useAsync(() => fetchCrews(companyId, true), [companyId], !isStore);

  const jobs = useMemo(
    () =>
      (data.data?.jobs ?? []).filter(
        (j) =>
          statusFilter.includes(j.status) &&
          (storeFilter === 'any' || j.store_id === storeFilter) &&
          (crewFilter === 'any' || j.crew_id === crewFilter),
      ),
    [data.data, statusFilter, storeFilter, crewFilter],
  );
  const availability = useMemo(() => new Map((data.data?.availability ?? []).map((a) => [a.day, a])), [data.data]);
  const jobsOn = (d: IsoDate) => jobs.filter((j) => {
    const r = displayRange(j);
    return inRange(d, r.start, r.end);
  });
  const blocksOn = (d: IsoDate) => (data.data?.blocks ?? []).filter((b) => inRange(d, b.start_date, b.end_date));
  const crewName = (id: string | null) => (id ? crews.data?.find((c) => c.id === id)?.name ?? 'ekipa' : 'cała firma');

  const unavailable = (d: IsoDate) => {
    const a = availability.get(d);
    return !a || a.status === 'full' || a.status === 'blocked' || d < today;
  };

  function onDayPress(d: IsoDate) {
    if (isStore && canWrite) {
      if (unavailable(d)) return;
      if (selStart && selEnd === selStart && d > selStart && !eachDay(selStart, d).some(unavailable)) {
        setSelEnd(d);
      } else {
        setSelStart(d);
        setSelEnd(d);
      }
      return;
    }
    setCursor(d);
    setView('day');
  }

  function move(dir: -1 | 1) {
    if (view === 'month') setCursor(addMonths(startOfMonth(cursor), dir));
    else if (view === 'week') setCursor(addDays(cursor, 7 * dir));
    else if (view === 'day') setCursor(addDays(cursor, dir));
    else setCursor(addDays(cursor, 30 * dir));
  }

  const title =
    view === 'month'
      ? formatMonthTitle(cursor)
      : view === 'week'
        ? formatRange(startOfWeek(cursor), addDays(startOfWeek(cursor), 6))
        : view === 'day'
          ? formatDateLong(cursor)
          : `${formatRange(cursor, addDays(cursor, 29))}`;

  const selected = (d: IsoDate) => !!selStart && !!selEnd && d >= selStart && d <= selEnd;

  return (
    <Screen maxWidth={1400}>
      <PageHeader
        title="Kalendarz"
        subtitle={isStore ? 'Wybierz wolny dzień lub kilka kolejnych dni i zgłoś montaż. Zajęte terminy innych sklepów widzisz jako niedostępne.' : undefined}
        actions={
          isAdmin && canWrite ? (
            <Button title="Nowe zlecenie" icon="add" onPress={() => router.push('/jobs/new')} />
          ) : isStore && canWrite ? (
            <Button title="Zgłoś montaż" icon="add" onPress={() => router.push('/jobs/new')} />
          ) : null
        }
      />

      <Card padded={false} style={{ padding: space.md, gap: space.md }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Row wrap style={{ flexShrink: 1, minWidth: 0 }}>
            <Row>
              <IconButton icon="chevron-back" label="Poprzedni okres" onPress={() => move(-1)} />
              <Button title="Dziś" variant="secondary" compact onPress={() => setCursor(today)} />
              <IconButton icon="chevron-forward" label="Następny okres" onPress={() => move(1)} />
            </Row>
            <AppText variant="subheading" accessibilityLiveRegion="polite" style={{ marginLeft: space.sm, flexShrink: 1 }}>
              {title}
            </AppText>
          </Row>
          <ChoiceChips<View_>
            value={view}
            onChange={setView}
            wrap={false}
            options={[
              { value: 'month', label: 'Miesiąc' },
              { value: 'week', label: 'Tydzień' },
              { value: 'day', label: 'Dzień' },
              { value: 'agenda', label: 'Lista' },
            ]}
          />
        </Row>
        {!isStore && !isWide ? (
          <Button
            title={showFilters ? 'Ukryj filtry' : `Filtry${activeFilters ? ` (${activeFilters})` : ''}`}
            variant="ghost"
            compact
            icon="options-outline"
            onPress={() => setShowFilters((v) => !v)}
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        {!isStore && (isWide || showFilters) ? (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {isAdmin ? (
                <View style={{ flexBasis: 240, flexShrink: 1, flexGrow: 1 }}>
                  <SelectField
                    label="Sklep"
                    value={storeFilter}
                    onChange={setStoreFilter}
                    options={[{ value: 'any', label: 'Wszystkie sklepy' }, ...(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
                  />
                </View>
              ) : null}
              <View style={{ flexBasis: 240, flexShrink: 1, flexGrow: 1 }}>
                <SelectField
                  label="Ekipa"
                  value={crewFilter}
                  onChange={setCrewFilter}
                  options={[{ value: 'any', label: 'Wszystkie ekipy' }, ...(crews.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                />
              </View>
            </View>
            <MultiChips<JobStatus> label="Status" values={statusFilter} onChange={setStatusFilter} options={ALL_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          </View>
        ) : null}
        <Row wrap gap={space.md}>
          {(['pending', 'confirmed', 'in_progress', 'completed'] as JobStatus[]).map((s) => (
            <Row key={s} gap={6}>
              <View style={[styles.legendBox, { backgroundColor: statusColors[s].bg, borderColor: statusColors[s].border, borderStyle: s === 'pending' ? 'dashed' : 'solid' }]} />
              <AppText variant="small">{STATUS_LABEL[s]}</AppText>
            </Row>
          ))}
          <Row gap={6}>
            <View style={[styles.legendBox, { backgroundColor: availabilityColors.full.bg }]} />
            <AppText variant="small">Brak wolnych ekip / zablokowany</AppText>
          </Row>
        </Row>
      </Card>

      {isStore && selStart ? (
        <Card style={styles.selectionBar}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <AppText style={{ fontWeight: '700' }}>{`Wybrany termin: ${formatRange(selStart, selEnd)}`}</AppText>
            <AppText variant="small">Kliknij późniejszy wolny dzień, aby wydłużyć zakres. Zgłoszenie wymaga akceptacji firmy montażowej.</AppText>
          </View>
          <Row wrap>
            <Button title="Wyczyść" variant="secondary" compact onPress={() => { setSelStart(null); setSelEnd(null); }} />
            <Button title="Zgłoś montaż" icon="send" onPress={() => router.push({ pathname: '/jobs/new', params: { start: selStart, end: selEnd ?? selStart } })} />
          </Row>
        </Card>
      ) : null}

      {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <LoadingState /> : null}

      {data.data && view === 'month' ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <View style={styles.weekHeader}>
            {WEEKDAYS_SHORT.map((w) => (
              <Text key={w} style={styles.weekHeaderText}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {monthGrid(startOfMonth(cursor)).map((d) => {
              const a = availability.get(d);
              const dayJobs = jobsOn(d);
              const inMonth = d.slice(0, 7) === cursor.slice(0, 7);
              const limit = isMedium ? 3 : 2;
              const dim = a && (a.status === 'full' || a.status === 'blocked');
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDateLong(d)}. ${dayJobs.length ? `Zlecenia: ${dayJobs.length}.` : ''} ${a ? availabilityColors[a.status].label : ''}`}
                  onPress={() => onDayPress(d)}
                  style={(s) => [
                    styles.monthCell,
                    { backgroundColor: dim ? availabilityColors[a!.status].bg : colors.surface },
                    !inMonth && { opacity: 0.55 },
                    selected(d) && { backgroundColor: '#CFE4F8' },
                    (s as any).hovered && { backgroundColor: '#F1F7FC' },
                    (s as any).focused && { borderColor: colors.focus, borderWidth: 2 },
                  ]}>
                  <Row gap={4} style={{ justifyContent: 'space-between' }}>
                    <Text style={[styles.dayNum, d === today && styles.today]}>{Number(d.slice(8))}</Text>
                    {a?.status === 'blocked' ? <Ionicons name="lock-closed" size={12} color={colors.textMuted} /> : null}
                    {isAdmin && a?.pending_requests ? <Text style={styles.pendingCount}>{`${a.pending_requests} oczek.`}</Text> : null}
                  </Row>
                  {isMedium && a && a.status !== 'available' ? (
                    <Text style={styles.cellAvail} numberOfLines={1}>
                      {a.status === 'partial' ? `wolne: ${a.total_crews - a.busy_crews}/${a.total_crews}` : availabilityColors[a.status].label}
                    </Text>
                  ) : null}
                  <View style={{ gap: 2 }}>
                    {dayJobs.slice(0, limit).map((j) => (
                      <EventChip key={j.id} job={j} day={d} compact={!isWide} />
                    ))}
                    {dayJobs.length > limit ? <Text style={styles.more}>{`+${dayJobs.length - limit} więcej`}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      {data.data && view === 'week' && isWide ? (
        <View style={styles.weekRow}>
          {eachDay(startOfWeek(cursor), addDays(startOfWeek(cursor), 6)).map((d) => (
            <Card key={d} style={[styles.weekCol, d === today && { borderColor: colors.accent }]} padded={false}>
              <Pressable onPress={() => onDayPress(d)} accessibilityRole="button" accessibilityLabel={formatDateLong(d)} style={{ padding: space.sm, gap: 4 }}>
                <AppText style={{ fontWeight: '700' }}>{formatDateNoYear(d)}</AppText>
                <AvailabilityTag a={availability.get(d)} />
              </Pressable>
              <View style={{ gap: 4, padding: space.sm, paddingTop: 0 }}>
                {blocksOn(d).map((b) => (
                  <Text key={b.id} style={styles.block}>{`Blokada: ${crewName(b.crew_id)}${b.reason ? ` – ${b.reason}` : ''}`}</Text>
                ))}
                {jobsOn(d).map((j) => (
                  <EventChip key={j.id} job={j} day={d} />
                ))}
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {data.data && (view === 'agenda' || view === 'day' || (view === 'week' && !isWide)) ? (
        <View style={{ gap: space.md }}>
          {eachDay(win.from, win.to).map((d) => {
            const dayJobs = jobsOn(d);
            const a = availability.get(d);
            const blocks = blocksOn(d);
            if (view === 'agenda' && !dayJobs.length && !blocks.length && !(isStore && a)) return null;
            const canPick = isStore && canWrite && !unavailable(d);
            return (
              <Card key={d} style={[d === today && { borderColor: colors.accent }, selected(d) && { borderColor: colors.primary, borderWidth: 2 }]}>
                <Row wrap style={{ justifyContent: 'space-between' }}>
                  <AppText variant="subheading">{`${formatDateNoYear(d)}${d === today ? ' (dziś)' : ''}`}</AppText>
                  <Row wrap>
                    <AvailabilityTag a={a} />
                    {isAdmin && a?.pending_requests ? <Text style={styles.pendingCount}>{`Oczekujące zgłoszenia: ${a.pending_requests}`}</Text> : null}
                    {canPick ? <Button title={selected(d) ? 'Wybrano' : 'Wybierz'} compact variant={selected(d) ? 'primary' : 'secondary'} onPress={() => onDayPress(d)} /> : null}
                  </Row>
                </Row>
                {blocks.map((b) => (
                  <Text key={b.id} style={styles.block}>{`Blokada: ${crewName(b.crew_id)}${b.reason ? ` – ${b.reason}` : ''}`}</Text>
                ))}
                {dayJobs.length === 0 && view === 'day' ? <AppText variant="muted">Brak zleceń tego dnia.</AppText> : null}
                {dayJobs.map((j) => (
                  <JobRow key={j.id} job={j} showStore={!isStore} />
                ))}
              </Card>
            );
          })}
          {view === 'agenda' && !isStore && jobs.length === 0 && !(data.data.blocks ?? []).length ? (
            <EmptyState title="Brak zleceń w tym okresie" icon="calendar-outline">
              Przejdź dalej strzałkami lub zmień filtry.
            </EmptyState>
          ) : null}
        </View>
      ) : null}

      {isStore && data.data ? (
        <Banner tone="info">Widzisz wyłącznie zlecenia swojego sklepu. Zajęte terminy innych sklepów są oznaczone jako niedostępne, bez szczegółów.</Banner>
      ) : null}
      {data.data && statusFilter.length === 0 ? <Banner tone="warning">Wybierz co najmniej jeden status, aby zobaczyć zlecenia.</Banner> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: '700', fontFamily: font.family },
  chipSub: { fontSize: 11, fontFamily: font.family },
  legendBox: { width: 16, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
  weekHeader: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border },
  weekHeaderText: { width: `${100 / 7}%`, textAlign: 'center', paddingVertical: 8, fontWeight: '700', color: colors.textMuted, fontSize: 12, fontFamily: font.family },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCell: {
    width: `${100 / 7}%`,
    minHeight: 112,
    padding: 4,
    gap: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  dayNum: { fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: font.family },
  today: { color: '#FFFFFF', backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 6, overflow: 'hidden' },
  pendingCount: { fontSize: 10, color: colors.warningText, backgroundColor: colors.warningBg, borderRadius: 6, paddingHorizontal: 4, fontWeight: '700', fontFamily: font.family },
  cellAvail: { fontSize: 10, color: colors.textMuted, fontFamily: font.family },
  more: { fontSize: 11, color: colors.primary, fontWeight: '700', fontFamily: font.family },
  weekRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  weekCol: { flex: 1, minWidth: 0, gap: 0 },
  availTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  availText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, fontFamily: font.family },
  block: { fontSize: 12, color: colors.textMuted, backgroundColor: '#E2E6EA', padding: 4, borderRadius: radius.sm, fontFamily: font.family },
  selectionBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderColor: colors.primary, borderWidth: 2 },
});
