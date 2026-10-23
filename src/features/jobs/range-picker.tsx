import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppText, Banner, Button, Dialog, MiniCalendar, Row } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { addDays, diffDays, eachDay, endOfMonth, formatDayCount, formatRange, monthGrid, startOfMonth, todayWarsaw, type IsoDate } from '@/lib/dates';
import type { AvailabilityDay } from '@/lib/types';
import { availabilityColors, colors, font, radius, space, touch } from '@/theme/tokens';
import { fetchAvailability } from './api';

/**
 * Inclusive date-range field with live availability. Stores cannot pick blocked or fully
 * booked days; administrators see the same information but may pick any day.
 */
export function DateRangeField({
  companyId,
  label,
  start,
  end,
  onChange,
  error,
  restrictToAvailable,
  minDate,
}: {
  companyId: string;
  label: string;
  start: IsoDate | null;
  end: IsoDate | null;
  onChange: (start: IsoDate, end: IsoDate) => void;
  error?: string | null;
  restrictToAvailable: boolean;
  minDate?: IsoDate;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(start ?? todayWarsaw()));
  const [draftStart, setDraftStart] = useState<IsoDate | null>(start);
  const [draftEnd, setDraftEnd] = useState<IsoDate | null>(end);

  const grid = monthGrid(month);
  const availability = useAsync(() => fetchAvailability(companyId, grid[0], grid[41]), [companyId, month], open);
  const byDay = new Map<IsoDate, AvailabilityDay>((availability.data ?? []).map((d) => [d.day, d]));

  const isUnavailable = (d: IsoDate) => {
    const a = byDay.get(d);
    return !!a && (a.status === 'full' || a.status === 'blocked');
  };

  // First tap selects a single day; a later tap after it extends the range; anything else restarts.
  function select(d: IsoDate) {
    const extending = draftStart && draftEnd === draftStart && d > draftStart;
    if (extending && !(restrictToAvailable && eachDay(draftStart, d).some(isUnavailable))) {
      setDraftEnd(d);
      return;
    }
    setDraftStart(d);
    setDraftEnd(d);
  }

  const rangeHasConflict = draftStart && draftEnd ? eachDay(draftStart, draftEnd).some(isUnavailable) : false;
  const days = draftStart && draftEnd ? diffDays(draftStart, draftEnd) + 1 : 0;

  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">
        {label}
        <Text style={{ color: colors.danger }}> *</Text>
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${start ? formatRange(start, end) : 'nie wybrano'}`}
        onPress={() => {
          setDraftStart(start);
          setDraftEnd(end);
          setMonth(startOfMonth(start ?? todayWarsaw()));
          setOpen(true);
        }}
        style={[styles.box, error ? { borderColor: colors.danger, borderWidth: 2 } : null]}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={[styles.boxText, !start && { color: '#7B8D9E' }]}>
          {start ? `${formatRange(start, end)} (${formatDayCount(diffDays(start, end ?? start) + 1)})` : 'Wybierz dzień lub kilka kolejnych dni'}
        </Text>
      </Pressable>
      {error ? (
        <AppText variant="small" style={{ color: colors.danger, fontWeight: '600' }}>
          {error}
        </AppText>
      ) : null}

      <Dialog
        visible={open}
        title={label}
        onClose={() => setOpen(false)}
        width={460}
        footer={
          <>
            <Button title="Anuluj" variant="secondary" onPress={() => setOpen(false)} />
            <Button
              title="Wybierz"
              disabled={!draftStart || (restrictToAvailable && rangeHasConflict)}
              onPress={() => {
                if (draftStart) onChange(draftStart, draftEnd ?? draftStart);
                setOpen(false);
              }}
            />
          </>
        }>
        <AppText variant="muted">Kliknij dzień rozpoczęcia, a przy montażu kilkudniowym – również dzień zakończenia.</AppText>
        <MiniCalendar
          month={month}
          onMonthChange={setMonth}
          selectedStart={draftStart}
          selectedEnd={draftEnd}
          minDate={minDate}
          onSelect={select}
          dayState={(d) => {
            const a = byDay.get(d);
            if (!a) return {};
            if (a.status === 'blocked') return { tone: 'blocked', disabled: restrictToAvailable };
            if (a.status === 'full') return { tone: 'full', disabled: restrictToAvailable };
            if (a.status === 'partial') return { tone: 'partial' };
            return {};
          }}
        />
        <Row wrap gap={space.md}>
          {(['available', 'partial', 'full', 'blocked'] as const).map((k) => (
            <Row key={k} gap={6}>
              <View style={[styles.legend, { backgroundColor: availabilityColors[k].bg }]} />
              <AppText variant="small">{availabilityColors[k].label}</AppText>
            </Row>
          ))}
        </Row>
        {availability.error ? <Banner tone="warning">Nie udało się wczytać dostępności. Termin sprawdzi firma montażowa.</Banner> : null}
        {draftStart ? (
          <AppText style={{ fontWeight: '600' }} accessibilityLiveRegion="polite">
            {`Wybrano: ${formatRange(draftStart, draftEnd)} (${formatDayCount(days)})`}
          </AppText>
        ) : null}
        {rangeHasConflict ? (
          <Banner tone="warning">
            {restrictToAvailable
              ? 'Wybrany zakres zawiera zajęte lub zablokowane dni. Wybierz inny termin.'
              : 'W wybranym zakresie są dni bez wolnych ekip lub zablokowane. Potwierdzenie może się nie udać.'}
          </Banner>
        ) : null}
        <AppText variant="small">Zgłoszenie nie rezerwuje terminu – rezerwację potwierdza firma montażowa.</AppText>
      </Dialog>
    </View>
  );
}

export function nextDays(n: number) {
  const t = todayWarsaw();
  return { from: t, to: addDays(t, n) };
}

export { endOfMonth };

const styles = StyleSheet.create({
  box: {
    minHeight: touch,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  boxText: { flex: 1, fontSize: font.size.md, color: colors.text, fontFamily: font.family },
  legend: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
});
