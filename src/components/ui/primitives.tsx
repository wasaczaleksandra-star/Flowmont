import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, font, radius, shadow, space, statusColors, touch } from '@/theme/tokens';
import { STATUS_LABEL, type JobStatus } from '@/lib/status';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
type Variant = 'title' | 'heading' | 'subheading' | 'body' | 'muted' | 'small' | 'label';

export function AppText({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text {...rest} style={[styles.textBase, textVariants[variant], style]} />;
}

const textVariants: Record<Variant, TextStyle> = {
  title: { fontSize: font.size.xxl, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  heading: { fontSize: font.size.xl, fontWeight: '700', color: colors.text },
  subheading: { fontSize: font.size.lg, fontWeight: '600', color: colors.text },
  body: { fontSize: font.size.md, color: colors.text, lineHeight: 22 },
  muted: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
  small: { fontSize: font.size.xs, color: colors.textMuted },
  label: { fontSize: font.size.sm, fontWeight: '600', color: colors.text },
};

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  compact,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const v = buttonVariants[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={(state) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: v.bg, borderColor: v.border },
        (state as any).hovered && !isDisabled && { backgroundColor: v.hover },
        state.pressed && !isDisabled && { backgroundColor: v.pressed },
        (state as any).focused && styles.focusRing,
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={v.text} />
      ) : null}
      <Text style={[styles.buttonText, { color: v.text }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; border: string; text: string; hover: string; pressed: string }> = {
  primary: { bg: colors.primary, border: colors.primary, text: colors.onPrimary, hover: '#003A6B', pressed: colors.primaryPressed },
  secondary: { bg: colors.surface, border: colors.borderStrong, text: colors.primary, hover: '#F1F7FC', pressed: '#E3EEF7' },
  ghost: { bg: 'transparent', border: 'transparent', text: colors.primary, hover: '#E6F0F8', pressed: '#D8E7F3' },
  danger: { bg: colors.surface, border: '#D9A49E', text: colors.danger, hover: colors.dangerBg, pressed: '#F5D5D1' },
  success: { bg: colors.success, border: colors.success, text: '#FFFFFF', hover: '#196A3C', pressed: '#145632' },
};

export function IconButton({
  icon,
  label,
  onPress,
  color = colors.primary,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={(state) => [
        styles.iconButton,
        (state as any).hovered && { backgroundColor: '#E6F0F8' },
        state.pressed && { backgroundColor: '#D8E7F3' },
        (state as any).focused && styles.focusRing,
        disabled && styles.disabled,
      ]}>
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function TextField({
  label,
  error,
  hint,
  required,
  multiline,
  style,
  ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string; required?: boolean; multiline?: boolean }) {
  return (
    <View style={styles.field}>
      <AppText variant="label" nativeID={`${label}-label`}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        aria-required={required}
        aria-invalid={!!error}
        placeholderTextColor="#7B8D9E"
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <AppText variant="small" style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small">{hint}</AppText>
      ) : null}
    </View>
  );
}

export function Checkbox({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={(state) => [styles.checkboxRow, (state as any).focused && styles.focusRing, disabled && styles.disabled]}>
      <View style={[styles.checkbox, value && styles.checkboxOn]}>{value ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}</View>
      <AppText style={{ flex: 1 }}>{label}</AppText>
    </Pressable>
  );
}

/** Single-choice chips (accessible radio group). */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  wrap = true,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  wrap?: boolean;
}) {
  const row = (
    <View style={[styles.chipsRow, wrap && { flexWrap: 'wrap' }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(o.value)}
            style={(state) => [styles.chip, selected && styles.chipOn, (state as any).focused && styles.focusRing]}>
            <Text style={[styles.chipText, selected && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <View style={styles.field}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      {wrap ? row : <ScrollView horizontal showsHorizontalScrollIndicator={false}>{row}</ScrollView>}
    </View>
  );
}

/** Multi-select chips. */
export function MultiChips<T extends string>({
  label,
  options,
  values,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  values: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <View style={styles.field}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={[styles.chipsRow, { flexWrap: 'wrap' }]}>
        {options.map((o) => {
          const selected = values.includes(o.value);
          return (
            <Pressable
              key={o.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(selected ? values.filter((v) => v !== o.value) : [...values, o.value])}
              style={(state) => [styles.chip, selected && styles.chipOn, (state as any).focused && styles.focusRing]}>
              {selected ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Screen({
  children,
  scroll = true,
  maxWidth = 1100,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  maxWidth?: number;
  padded?: boolean;
}) {
  const inner = <View style={[styles.screenInner, { maxWidth }, padded && styles.screenPadded]}>{children}</View>;
  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <View style={styles.pageHeader}>
      <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText variant="muted">{subtitle}</AppText> : null}
      </View>
      {actions ? <View style={styles.headerActions}>{actions}</View> : null}
    </View>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[styles.card, padded && { padding: space.lg }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="subheading" accessibilityRole="header" style={{ flex: 1 }}>
        {children}
      </AppText>
      {right}
    </View>
  );
}

export function Row({ children, gap = space.sm, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.sm }} />;
}

// ---------------------------------------------------------------------------
// Status & feedback
// ---------------------------------------------------------------------------
export function StatusBadge({ status }: { status: JobStatus }) {
  const c = statusColors[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border }]} accessibilityLabel={`Status: ${STATUS_LABEL[status]}`}>
      <View style={[styles.badgeDot, { backgroundColor: c.border }, status === 'pending' && styles.badgeDotHollow]} />
      <Text style={[styles.badgeText, { color: c.text }]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success' }) {
  const t = {
    neutral: { bg: '#EEF2F6', fg: colors.textMuted },
    info: { bg: colors.infoBg, fg: colors.primary },
    warning: { bg: colors.warningBg, fg: colors.warningText },
    danger: { bg: colors.dangerBg, fg: colors.danger },
    success: { bg: colors.successBg, fg: colors.success },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const t = {
    info: { bg: colors.infoBg, border: '#9CC7EE', icon: 'information-circle' as IconName, fg: colors.primary },
    warning: { bg: colors.warningBg, border: '#F3C27A', icon: 'alert-circle' as IconName, fg: colors.warningText },
    danger: { bg: colors.dangerBg, border: '#E3A59E', icon: 'close-circle' as IconName, fg: colors.danger },
    success: { bg: colors.successBg, border: '#9FD0B3', icon: 'checkmark-circle' as IconName, fg: colors.success },
  }[tone];
  return (
    <View
      style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion="polite">
      <Ionicons name={t.icon} size={20} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[styles.bannerTitle, { color: t.fg }]}>{title}</Text> : null}
        {typeof children === 'string' ? <AppText style={{ color: colors.text }}>{children}</AppText> : children}
      </View>
      {action}
    </View>
  );
}

export function LoadingState({ label = 'Wczytywanie…' }: { label?: string }) {
  return (
    <View style={styles.centerState} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} />
      <AppText variant="muted">{label}</AppText>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.centerState}>
      <Banner tone="danger" title="Nie udało się wczytać danych">
        {message}
      </Banner>
      {onRetry ? <Button title="Spróbuj ponownie" variant="secondary" icon="refresh" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ icon = 'file-tray-outline', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={32} color={colors.textMuted} />
      <AppText variant="subheading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {children ? (
        <AppText variant="muted" style={{ textAlign: 'center', maxWidth: 420 }}>
          {children}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function KeyValue({ label, value, children }: { label: string; value?: string | null; children?: ReactNode }) {
  return (
    <View style={styles.kv}>
      <AppText variant="small" style={{ fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </AppText>
      {children ?? <AppText>{value && value.trim() !== '' ? value : '—'}</AppText>}
    </View>
  );
}

const styles = StyleSheet.create({
  textBase: { fontFamily: font.family },
  button: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { minHeight: 36, paddingHorizontal: space.md },
  buttonText: { fontSize: font.size.md, fontWeight: '600', fontFamily: font.family },
  iconButton: { width: touch, height: touch, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  focusRing: Platform.select({
    web: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.focus, outlineOffset: 2 } as object,
    default: { borderColor: colors.focus, borderWidth: 2 },
  }) as ViewStyle,
  disabled: { opacity: 0.5 },
  field: { gap: 6 },
  input: {
    minHeight: touch,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: font.size.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontFamily: font.family,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  errorText: { color: colors.danger, fontWeight: '600' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch, borderRadius: radius.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipsRow: { flexDirection: 'row', gap: space.sm },
  chip: {
    minHeight: 38,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: font.size.sm, fontWeight: '500', fontFamily: font.family },
  chipTextOn: { color: colors.onPrimary },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { flexGrow: 1 },
  screenInner: { width: '100%', alignSelf: 'center', gap: space.lg, flexGrow: 1 },
  screenPadded: { padding: space.lg, paddingBottom: space.xxl },
  pageHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: space.md },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.md,
    ...(shadow as object),
  },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeDotHollow: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#C07A00' },
  badgeText: { fontSize: font.size.xs, fontWeight: '700', fontFamily: font.family },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: font.size.xs, fontWeight: '600', fontFamily: font.family },
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, alignItems: 'flex-start' },
  bannerTitle: { fontWeight: '700', fontSize: font.size.md, fontFamily: font.family },
  centerState: { padding: space.xl, alignItems: 'center', justifyContent: 'center', gap: space.md },
  empty: {
    padding: space.xl,
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
  },
  kv: { gap: 2, minWidth: 140, flexShrink: 1 },
});
