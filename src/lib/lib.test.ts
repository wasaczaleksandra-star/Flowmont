import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  eachDay,
  formatDateLong,
  formatRange,
  formatTimestamp,
  isIsoDate,
  isWarsawSummerTime,
  monthGrid,
  parseFlexibleDate,
  rangesOverlap,
  startOfWeek,
  todayWarsaw,
} from './dates';
import { availableActions, canTransition, displayRange } from './status';
import { safeNextPath } from './paths';

describe('dates', () => {
  it('handles daylight-saving transitions without shifting days', () => {
    // Europe/Warsaw switches on 2026-03-29 and 2026-10-25.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    expect(eachDay('2026-10-24', '2026-10-27')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('computes today in Warsaw around midnight UTC', () => {
    // 23:30 UTC on 23 Oct 2026 is already 24 Oct in Warsaw (UTC+2).
    expect(todayWarsaw(new Date('2026-10-23T23:30:00Z'))).toBe('2026-10-24');
    // 23:30 UTC on 1 Dec 2026 is 00:30 on 2 Dec in Warsaw (UTC+1).
    expect(todayWarsaw(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-02');
    expect(todayWarsaw(new Date('2026-12-01T22:30:00Z'))).toBe('2026-12-01');
    expect(isWarsawSummerTime(new Date('2026-07-01T12:00:00Z'))).toBe(true);
    expect(isWarsawSummerTime(new Date('2026-10-25T01:00:00Z'))).toBe(false);
  });

  it('formats Polish dates and ranges naturally', () => {
    expect(formatDateLong('2026-11-12')).toBe('czwartek, 12 listopada 2026');
    expect(formatRange('2026-11-12')).toBe('12 listopada 2026');
    expect(formatRange('2026-11-12', '2026-11-14')).toBe('12–14 listopada 2026');
    expect(formatRange('2026-11-30', '2026-12-02')).toBe('30 listopada – 2 grudnia 2026');
    expect(formatRange('2026-12-30', '2027-01-02')).toBe('30 grudnia 2026 – 2 stycznia 2027');
    expect(formatTimestamp('2026-10-23T12:05:00Z')).toBe('23.10.2026, 14:05');
  });

  it('treats ranges as inclusive', () => {
    expect(rangesOverlap('2026-11-10', '2026-11-12', '2026-11-12', '2026-11-13')).toBe(true);
    expect(rangesOverlap('2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13')).toBe(false);
  });

  it('builds a Monday-first month grid', () => {
    const grid = monthGrid('2026-11-15');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-10-26');
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09');
  });

  it('parses spreadsheet dates', () => {
    expect(parseFlexibleDate('12.11.2026')).toBe('2026-11-12');
    expect(parseFlexibleDate('2026-11-12')).toBe('2026-11-12');
    expect(parseFlexibleDate('1/2/2026')).toBe('2026-02-01');
    expect(parseFlexibleDate(46338)).toBe('2026-11-12');
    expect(parseFlexibleDate(new Date(Date.UTC(2026, 10, 12)))).toBe('2026-11-12');
    expect(parseFlexibleDate('31.02.2026')).toBeNull();
    expect(parseFlexibleDate('jutro')).toBeNull();
    expect(isIsoDate('2026-13-01')).toBe(false);
  });
});

describe('status rules', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('pending', 'in_progress')).toBe(false);
    expect(canTransition('confirmed', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });

  const job = { status: 'pending' as const, crew_id: 'c1', store_id: 's1' };

  it('offers role-appropriate actions', () => {
    expect(availableActions(job, { role: 'admin', storeIds: [], crewIds: [], canWrite: true })).toContain('confirm');
    expect(availableActions(job, { role: 'store_user', storeIds: ['s1'], crewIds: [], canWrite: true })).toEqual(['edit', 'withdraw']);
    expect(availableActions(job, { role: 'store_user', storeIds: ['s2'], crewIds: [], canWrite: true })).toEqual([]);
    expect(availableActions({ ...job, status: 'confirmed' }, { role: 'crew_member', storeIds: [], crewIds: ['c1'], canWrite: true })).toEqual(['start']);
    expect(availableActions({ ...job, status: 'confirmed' }, { role: 'crew_member', storeIds: [], crewIds: ['c2'], canWrite: true })).toEqual([]);
    expect(availableActions({ ...job, status: 'confirmed' }, { role: 'store_user', storeIds: ['s1'], crewIds: [], canWrite: true })).toEqual([]);
  });

  it('offers nothing in read-only mode', () => {
    expect(availableActions(job, { role: 'admin', storeIds: [], crewIds: [], canWrite: false })).toEqual([]);
  });

  it('shows the confirmed range once scheduled', () => {
    const base = { requested_start: '2026-11-10', requested_end: '2026-11-10', confirmed_start: '2026-11-12', confirmed_end: '2026-11-13' };
    expect(displayRange({ ...base, status: 'confirmed' })).toEqual({ start: '2026-11-12', end: '2026-11-13', confirmed: true });
    expect(displayRange({ ...base, status: 'pending', confirmed_start: null, confirmed_end: null })).toMatchObject({ confirmed: false });
  });
});

describe('redirects', () => {
  it('accepts only same-app relative paths', () => {
    expect(safeNextPath('/invite/abc')).toBe('/invite/abc');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
  });
});
