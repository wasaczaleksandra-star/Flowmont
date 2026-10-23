import { describe, expect, it } from 'vitest';
import { applyMapping, autoMap, missingRequired, parseCsv, templateCsv, toCsv } from './parse';

describe('import parsing', () => {
  it('parses Polish Excel CSV (semicolons, BOM, quotes, CRLF)', () => {
    const csv = '﻿Nazwa sklepu;E-mail;Uwagi\r\n"Okna ""Max""";a@b.pl;"linia 1\nlinia 2"\r\n;;\r\nDrugi;;x\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Nazwa sklepu', 'E-mail', 'Uwagi'],
      ['Okna "Max"', 'a@b.pl', 'linia 1\nlinia 2'],
      ['Drugi', '', 'x'],
    ]);
  });

  it('parses comma-separated files too', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('maps headers automatically, including Polish characters and aliases', () => {
    expect(autoMap(['Sklep', 'Imię i nazwisko', 'Miejscowość', 'Kod pocztowy', 'Data montażu', 'Coś innego'], 'jobs')).toEqual([
      'store_name',
      'customer_name',
      'city',
      'postal_code',
      'requested_start',
      null,
    ]);
  });

  it('reports missing required columns', () => {
    expect(missingRequired(['name'], 'stores')).toEqual([]);
    expect(missingRequired(['store_name'], 'jobs').map((f) => f.key)).toContain('customer_name');
  });

  it('normalises dates and never passes tenant columns', () => {
    const rows = applyMapping([['Sklep A', '12.11.2026', 46339, 'x']], ['store_name', 'requested_start', 'requested_end', 'company_id'], 'jobs');
    expect(rows).toEqual([{ store_name: 'Sklep A', requested_start: '2026-11-12', requested_end: '2026-11-13' }]);
    const bad = applyMapping([['zła data']], ['requested_start'], 'jobs');
    expect(bad[0].requested_start).toBe('zła data');
  });

  it('builds templates that round-trip', () => {
    const t = templateCsv('jobs');
    const parsed = parseCsv(t);
    expect(autoMap(parsed[0], 'jobs').every((k) => k !== null)).toBe(true);
    expect(parseCsv(toCsv([['a;b', 'c']]))).toEqual([['a;b', 'c']]);
  });
});
