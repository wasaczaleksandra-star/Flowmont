// Flowmont brand tokens – "Electric Sunset" palette (approved reference):
//   #00457F navy · #2F8EE0 blue · #EDF5FA ice · #FFA723 amber · #EC6206 orange
// Text/background pairs meet WCAG AA contrast.
import { Platform } from 'react-native';

export const palette = {
  navy: '#00457F',
  navyDark: '#00305A',
  blue: '#2F8EE0',
  ice: '#EDF5FA',
  amber: '#FFA723',
  orange: '#EC6206',
  white: '#FFFFFF',
  ink: '#0B1F33',
  inkMuted: '#4A5D70',
  line: '#D3E1EC',
  lineStrong: '#A9C1D6',
  danger: '#B3261E',
  dangerBg: '#FBE9E7',
  success: '#1E7A46',
  successBg: '#E5F4EC',
};

export const colors = {
  bg: palette.ice,
  surface: palette.white,
  surfaceAlt: '#F6FAFD',
  text: palette.ink,
  textMuted: palette.inkMuted,
  border: palette.line,
  borderStrong: palette.lineStrong,
  primary: palette.navy,
  primaryPressed: palette.navyDark,
  onPrimary: palette.white,
  accent: palette.orange,
  focus: palette.blue,
  danger: palette.danger,
  dangerBg: palette.dangerBg,
  success: palette.success,
  successBg: palette.successBg,
  warningBg: '#FFF4E0',
  warningText: '#7A4300',
  infoBg: '#E3F0FC',
};

export const statusColors = {
  pending: { bg: '#FFF1D6', border: palette.amber, text: '#6E3F00' },
  confirmed: { bg: '#E3F0FC', border: palette.blue, text: palette.navy },
  in_progress: { bg: '#FDE8DA', border: palette.orange, text: '#8A3A03' },
  completed: { bg: '#E6ECF2', border: '#7F97AD', text: '#2F4559' },
  rejected: { bg: '#F7E3DF', border: '#C2604B', text: '#7C2A18' },
  cancelled: { bg: '#EEF0F2', border: '#A0A8B0', text: '#4F5962' },
} as const;

export const availabilityColors = {
  available: { bg: '#FFFFFF', text: palette.ink, label: 'Wolny termin' },
  partial: { bg: '#F1F8FF', text: palette.ink, label: 'Częściowo zajęty' },
  full: { bg: '#E9EEF2', text: '#5B6670', label: 'Brak wolnych ekip' },
  blocked: { bg: '#E2E6EA', text: '#5B6670', label: 'Zablokowany' },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };
export const font = {
  family: Platform.select({ web: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', default: undefined }),
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 },
};
export const shadow = Platform.select({
  web: { boxShadow: '0 1px 2px rgba(0, 48, 90, 0.08)' } as object,
  default: { elevation: 1, shadowColor: '#00305A', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
});
/** Minimum touch target (WCAG 2.5.5 / platform guidelines). */
export const touch = 44;
export const breakpoints = { wide: 960, medium: 640 };
