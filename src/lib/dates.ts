// Calendar-date helpers working on ISO date strings ("YYYY-MM-DD").
// All-day bookings never go through Date objects in local time, so daylight-saving
// transitions cannot shift a day. "Today" and timestamps are resolved in Europe/Warsaw.

export type IsoDate = string;

export const TIME_ZONE = 'Europe/Warsaw';

const MONTHS_NOM = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
export const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

export function isIsoDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUtc(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

export function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return fromUtc(dt);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** ISO weekday index: 0 = Monday … 6 = Sunday. */
export function weekdayIndex(d: IsoDate): number {
  return (toUtc(d).getUTCDay() + 6) % 7;
}

export function startOfWeek(d: IsoDate): IsoDate {
  return addDays(d, -weekdayIndex(d));
}

export function startOfMonth(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: IsoDate): IsoDate {
  return addDays(addMonths(d, 1), -1);
}

/** 6×7 grid of days covering the month, starting on Monday. */
export function monthGrid(d: IsoDate): IsoDate[] {
  const first = startOfWeek(startOfMonth(d));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const n = diffDays(start, end);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

/** True when inclusive ranges [aStart, aEnd] and [bStart, bEnd] share at least one day. */
export function rangesOverlap(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function inRange(day: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return day >= start && day <= end;
}

/** Current calendar date in Europe/Warsaw. */
export function todayWarsaw(now: Date = new Date()): IsoDate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const v = `${get('year')}-${get('month')}-${get('day')}`;
    if (isIsoDate(v)) return v;
  } catch {
    // fall through
  }
  // Fallback without Intl time zone support: Warsaw is UTC+1 (winter) / UTC+2 (summer).
  const offset = isWarsawSummerTime(now) ? 2 : 1;
  return fromUtc(new Date(now.getTime() + offset * 3_600_000));
}

/** EU rule: summer time from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC. */
export function isWarsawSummerTime(now: Date): boolean {
  const y = now.getUTCFullYear();
  const lastSunday = (month: number) => {
    const d = new Date(Date.UTC(y, month + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  };
  const t = now.getTime();
  return t >= lastSunday(2) && t < lastSunday(9);
}

function parts(d: IsoDate) {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, day };
}

/** "czwartek, 12 listopada 2026" */
export function formatDateLong(d: IsoDate): string {
  const { y, m, day } = parts(d);
  return `${WEEKDAYS[weekdayIndex(d)]}, ${day} ${MONTHS_GEN[m - 1]} ${y}`;
}

/** "czwartek, 12 listopada" */
export function formatDateNoYear(d: IsoDate): string {
  const { m, day } = parts(d);
  return `${WEEKDAYS[weekdayIndex(d)]}, ${day} ${MONTHS_GEN[m - 1]}`;
}

/** "12.11.2026" */
export function formatDateShort(d: IsoDate): string {
  const { y, m, day } = parts(d);
  return `${String(day).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

/** "listopad 2026" */
export function formatMonthTitle(d: IsoDate): string {
  const { y, m } = parts(d);
  const name = MONTHS_NOM[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export function weekdayName(d: IsoDate): string {
  return WEEKDAYS[weekdayIndex(d)];
}

/**
 * Natural Polish range for inclusive all-day ranges:
 * "12 listopada 2026", "12–14 listopada 2026", "30 listopada – 2 grudnia 2026".
 */
export function formatRange(start: IsoDate, end?: IsoDate | null): string {
  const a = parts(start);
  if (!end || end === start) return `${a.day} ${MONTHS_GEN[a.m - 1]} ${a.y}`;
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) return `${a.day}–${b.day} ${MONTHS_GEN[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.day} ${MONTHS_GEN[a.m - 1]} – ${b.day} ${MONTHS_GEN[b.m - 1]} ${b.y}`;
  return `${a.day} ${MONTHS_GEN[a.m - 1]} ${a.y} – ${b.day} ${MONTHS_GEN[b.m - 1]} ${b.y}`;
}

/** "1 dzień", "3 dni" */
export function formatDayCount(n: number): string {
  return n === 1 ? '1 dzień' : `${n} dni`;
}

/** Timestamp in Europe/Warsaw: "23.10.2026, 14:05". */
export function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  try {
    const p = new Intl.DateTimeFormat('pl-PL', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${get('day')}.${get('month')}.${get('year')}, ${get('hour')}:${get('minute')}`;
  } catch {
    const offset = isWarsawSummerTime(date) ? 2 : 1;
    const local = new Date(date.getTime() + offset * 3_600_000).toISOString();
    return `${local.slice(8, 10)}.${local.slice(5, 7)}.${local.slice(0, 4)}, ${local.slice(11, 16)}`;
  }
}

/**
 * Parses user/spreadsheet dates into ISO: "2026-11-12", "12.11.2026", "12/11/2026",
 * "12-11-2026", Excel serial numbers and Date objects (taken at their UTC calendar day).
 */
export function parseFlexibleDate(v: unknown): IsoDate | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return fromUtc(new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())));
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel serial date (1900 system): day 25569 = 1970-01-01.
    return fromUtc(new Date(Math.round((v - 25569) * 86_400_000)));
  }
  const s = String(v).trim();
  if (isIsoDate(s)) return s;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const c = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isIsoDate(c) ? c : null;
  }
  const pl = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (pl) {
    const c = `${pl[3]}-${pl[2].padStart(2, '0')}-${pl[1].padStart(2, '0')}`;
    return isIsoDate(c) ? c : null;
  }
  return null;
}
