import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, space, touch } from '@/theme/tokens';
import {
  addMonths,
  formatDateShort,
  formatMonthTitle,
  monthGrid,
  startOfMonth,
  todayWarsaw,
  WEEKDAYS_SHORT,
  formatDateLong,
  type IsoDate,
} from '@/lib/dates';
import { AppText, Button, IconButton, TextField } from './primitives';

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
export function Dialog({
  visible,
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij okno" accessibilityRole="button" />
        <View style={[styles.dialog, { maxWidth: width }]} accessibilityViewIsModal aria-modal role="dialog" aria-label={title}>
          <View style={styles.dialogHeader}>
            <AppText variant="heading" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </AppText>
            <IconButton icon="close" label="Zamknij" onPress={onClose} />
          </View>
          <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.dialogFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Confirmation before destructive or important actions, with an optional reason field. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  reasonLabel,
  loading,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  reasonLabel?: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setReason('');
  }
  return (
    <Dialog
      visible={visible}
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button title="Anuluj" variant="secondary" onPress={onClose} />
          <Button title={confirmLabel} variant={destructive ? 'danger' : 'primary'} loading={loading} onPress={() => onConfirm(reason.trim())} />
        </>
      }>
      <AppText>{message}</AppText>
      {reasonLabel ? <TextField label={reasonLabel} value={reason} onChangeText={setReason} multiline placeholder="Opcjonalnie" /> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type Toast = { id: number; text: string; tone: 'success' | 'error' | 'info' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const show = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <View pointerEvents="box-none" style={styles.toastWrap}>
        {toasts.map((t) => (
          <View
            key={t.id}
            accessibilityLiveRegion="polite"
            accessibilityRole={t.tone === 'error' ? 'alert' : undefined}
            style={[styles.toast, t.tone === 'error' ? { backgroundColor: colors.danger } : t.tone === 'info' ? { backgroundColor: colors.primary } : { backgroundColor: colors.success }]}>
            <Ionicons name={t.tone === 'error' ? 'alert-circle' : 'checkmark-circle'} size={18} color="#fff" />
            <Text style={styles.toastText}>{t.text}</Text>
          </View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Select (modal list) – works the same on web, iOS and Android
// ---------------------------------------------------------------------------
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Wybierz…',
  required,
  error,
  disabled,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string; description?: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        accessibilityHint="Otwiera listę do wyboru"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={(s) => [styles.selectBox, error ? { borderColor: colors.danger, borderWidth: 2 } : null, (s as any).focused && styles.focus, disabled && { opacity: 0.5 }]}>
        <Text style={[styles.selectText, !current && { color: '#7B8D9E' }]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error ? <AppText variant="small" style={{ color: colors.danger, fontWeight: '600' }}>{error}</AppText> : null}
      <Dialog visible={open} title={label} onClose={() => setOpen(false)} width={460}>
        {options.length === 0 ? <AppText variant="muted">Brak pozycji do wyboru.</AppText> : null}
        {options.map((o) => (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.value === value }}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
            style={(s) => [styles.option, o.value === value && styles.optionOn, (s as any).hovered && { backgroundColor: '#F1F7FC' }, (s as any).focused && styles.focus]}>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontWeight: o.value === value ? '700' : '400' }}>{o.label}</AppText>
              {o.description ? <AppText variant="small">{o.description}</AppText> : null}
            </View>
            {o.value === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          </Pressable>
        ))}
      </Dialog>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Date picker
// ---------------------------------------------------------------------------
export type DayState = { disabled?: boolean; tone?: 'full' | 'blocked' | 'partial' };

export function MiniCalendar({
  month,
  onMonthChange,
  selectedStart,
  selectedEnd,
  onSelect,
  dayState,
  minDate,
}: {
  month: IsoDate;
  onMonthChange: (m: IsoDate) => void;
  selectedStart?: IsoDate | null;
  selectedEnd?: IsoDate | null;
  onSelect: (d: IsoDate) => void;
  dayState?: (d: IsoDate) => DayState;
  minDate?: IsoDate;
}) {
  const days = useMemo(() => monthGrid(month), [month]);
  const today = todayWarsaw();
  const ym = month.slice(0, 7);
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.calHeader}>
        <IconButton icon="chevron-back" label="Poprzedni miesiąc" onPress={() => onMonthChange(addMonths(month, -1))} />
        <AppText variant="subheading" style={{ flex: 1, textAlign: 'center' }} accessibilityLiveRegion="polite">
          {formatMonthTitle(month)}
        </AppText>
        <IconButton icon="chevron-forward" label="Następny miesiąc" onPress={() => onMonthChange(addMonths(month, 1))} />
      </View>
      <View style={styles.calGrid}>
        {WEEKDAYS_SHORT.map((w) => (
          <Text key={w} style={styles.calWeekday}>
            {w}
          </Text>
        ))}
        {days.map((d) => {
          const st = dayState?.(d) ?? {};
          const disabled = st.disabled || (minDate ? d < minDate : false);
          const inMonth = d.slice(0, 7) === ym;
          const isStart = d === selectedStart;
          const isEnd = d === selectedEnd;
          const inSel = selectedStart && selectedEnd && d > selectedStart && d < selectedEnd;
          return (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityLabel={`${formatDateLong(d)}${disabled ? ', niedostępny' : ''}`}
              accessibilityState={{ disabled, selected: isStart || isEnd || !!inSel }}
              disabled={disabled}
              onPress={() => onSelect(d)}
              style={(s) => [
                styles.calDay,
                st.tone === 'full' && { backgroundColor: '#E9EEF2' },
                st.tone === 'blocked' && { backgroundColor: '#E2E6EA' },
                st.tone === 'partial' && { backgroundColor: '#F1F8FF' },
                inSel && { backgroundColor: '#CFE4F8' },
                (isStart || isEnd) && { backgroundColor: colors.primary },
                (s as any).focused && styles.focus,
              ]}>
              <Text
                style={[
                  styles.calDayText,
                  !inMonth && { color: '#9AABBA' },
                  disabled && { color: '#A6B2BD', textDecorationLine: 'line-through' },
                  d === today && { fontWeight: '800', color: colors.accent },
                  (isStart || isEnd) && { color: '#fff' },
                ]}>
                {Number(d.slice(8))}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function DateField({
  label,
  value,
  onChange,
  required,
  error,
  minDate,
}: {
  label: string;
  value: IsoDate | null;
  onChange: (d: IsoDate) => void;
  required?: boolean;
  error?: string | null;
  minDate?: IsoDate;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(value ?? todayWarsaw()));
  return (
    <View style={{ gap: 6, flex: 1, minWidth: 160 }}>
      <AppText variant="label">
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatDateLong(value) : 'nie wybrano'}`}
        onPress={() => {
          setMonth(startOfMonth(value ?? todayWarsaw()));
          setOpen(true);
        }}
        style={(s) => [styles.selectBox, error ? { borderColor: colors.danger, borderWidth: 2 } : null, (s as any).focused && styles.focus]}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={[styles.selectText, !value && { color: '#7B8D9E' }]}>{value ? formatDateShort(value) : 'DD.MM.RRRR'}</Text>
      </Pressable>
      {error ? <AppText variant="small" style={{ color: colors.danger, fontWeight: '600' }}>{error}</AppText> : null}
      <Dialog visible={open} title={label} onClose={() => setOpen(false)} width={420}>
        <MiniCalendar
          month={month}
          onMonthChange={setMonth}
          selectedStart={value}
          selectedEnd={value}
          minDate={minDate}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 28, 52, 0.45)', alignItems: 'center', justifyContent: 'center', padding: space.md },
  dialog: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    maxHeight: '92%',
  },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dialogFooter: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    maxWidth: 560,
  },
  toastText: { color: '#fff', fontWeight: '600', fontSize: font.size.sm, flexShrink: 1, fontFamily: font.family },
  selectBox: {
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
  selectText: { flex: 1, fontSize: font.size.md, color: colors.text, fontFamily: font.family },
  focus: Platform.select({
    web: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.focus, outlineOffset: 2 } as object,
    default: { borderColor: colors.focus, borderWidth: 2 },
  }) as object,
  option: { flexDirection: 'row', alignItems: 'center', minHeight: touch, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, gap: space.sm },
  optionOn: { backgroundColor: colors.infoBg },
  calHeader: { flexDirection: 'row', alignItems: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calWeekday: { width: `${100 / 7}%`, textAlign: 'center', color: colors.textMuted, fontSize: 12, fontWeight: '700', paddingVertical: 4, fontFamily: font.family },
  calDay: { width: `${100 / 7}%`, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  calDayText: { fontSize: 15, color: colors.text, fontFamily: font.family },
});
