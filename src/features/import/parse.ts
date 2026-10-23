// Spreadsheet import helpers (pure – unit tested). The server re-validates every row.
import { parseFlexibleDate } from '../../lib/dates';

export type ImportKind = 'stores' | 'jobs';

export type FieldDef = { key: string; label: string; required?: boolean; aliases: string[]; type?: 'date' };

export const FIELDS: Record<ImportKind, FieldDef[]> = {
  stores: [
    { key: 'name', label: 'Nazwa sklepu', required: true, aliases: ['nazwa', 'sklep', 'nazwa sklepu', 'name', 'store'] },
    { key: 'nip', label: 'NIP', aliases: ['nip', 'tax id', 'vat'] },
    { key: 'email', label: 'E-mail', aliases: ['email', 'e-mail', 'mail', 'adres email', 'adres e-mail'] },
    { key: 'phone', label: 'Telefon', aliases: ['telefon', 'tel', 'phone', 'nr telefonu', 'numer telefonu'] },
    { key: 'street', label: 'Ulica i numer', aliases: ['ulica', 'adres', 'ulica i numer', 'street', 'address'] },
    { key: 'postal_code', label: 'Kod pocztowy', aliases: ['kod', 'kod pocztowy', 'postal code', 'zip'] },
    { key: 'city', label: 'Miejscowość', aliases: ['miasto', 'miejscowosc', 'miejscowość', 'city'] },
    { key: 'contact_person', label: 'Osoba kontaktowa', aliases: ['osoba kontaktowa', 'kontakt', 'contact', 'contact person'] },
    { key: 'notes', label: 'Notatki', aliases: ['notatki', 'uwagi', 'notes'] },
  ],
  jobs: [
    { key: 'store_name', label: 'Sklep', required: true, aliases: ['sklep', 'nazwa sklepu', 'store', 'partner'] },
    { key: 'customer_name', label: 'Klient', required: true, aliases: ['klient', 'imie i nazwisko', 'imię i nazwisko', 'customer', 'nazwisko'] },
    { key: 'customer_phone', label: 'Telefon klienta', aliases: ['telefon', 'telefon klienta', 'tel', 'phone'] },
    { key: 'street', label: 'Ulica i numer', required: true, aliases: ['ulica', 'adres', 'ulica i numer', 'street', 'address'] },
    { key: 'postal_code', label: 'Kod pocztowy', required: true, aliases: ['kod', 'kod pocztowy', 'postal code', 'zip'] },
    { key: 'city', label: 'Miejscowość', required: true, aliases: ['miasto', 'miejscowosc', 'miejscowość', 'city'] },
    { key: 'description', label: 'Opis montażu', required: true, aliases: ['opis', 'opis montazu', 'opis montażu', 'zakres', 'description'] },
    { key: 'requested_start', label: 'Data od', required: true, type: 'date', aliases: ['data', 'data od', 'termin', 'data montazu', 'data montażu', 'start', 'od'] },
    { key: 'requested_end', label: 'Data do', type: 'date', aliases: ['data do', 'koniec', 'end', 'do'] },
    { key: 'estimated_duration', label: 'Szacowany czas', aliases: ['czas', 'szacowany czas', 'czas montazu', 'czas montażu', 'duration'] },
    { key: 'access_instructions', label: 'Dojazd i parking', aliases: ['dojazd', 'parking', 'dojazd i parking', 'instrukcje'] },
    { key: 'notes', label: 'Uwagi', aliases: ['uwagi', 'notatki', 'notes'] },
    { key: 'status', label: 'Status (oczekuje/potwierdzone)', aliases: ['status'] },
    { key: 'crew_name', label: 'Ekipa', aliases: ['ekipa', 'crew', 'zespol', 'zespół'] },
    { key: 'external_ref', label: 'Numer zewnętrzny', aliases: ['numer', 'nr zlecenia', 'numer zlecenia', 'external ref', 'id', 'numer zewnetrzny', 'numer zewnętrzny'] },
  ],
};

/** Columns the template contains. Tenant identifiers are never part of an import. */
export const FORBIDDEN_KEYS = ['company_id', 'tenant', 'firma_id'];

export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suggests a field for every column header (null = ignore column). */
export function autoMap(headers: string[], kind: ImportKind): (string | null)[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const n = normalizeHeader(h);
    const field = FIELDS[kind].find((f) => !used.has(f.key) && (normalizeHeader(f.label) === n || f.aliases.some((a) => normalizeHeader(a) === n)));
    if (field) used.add(field.key);
    return field?.key ?? null;
  });
}

/** Detects the delimiter from the header line (Polish Excel uses semicolons). */
export function detectDelimiter(firstLine: string): string {
  const counts = [';', ',', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/** RFC 4180-style CSV parser with quoted fields, CRLF and BOM support. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return parseFlexibleDate(v) ?? '';
  return String(v).trim();
}

/** Applies a column mapping. Dates are normalised to ISO; unparseable values are passed on for the server to report. */
export function applyMapping(rows: unknown[][], mapping: (string | null)[], kind: ImportKind): Record<string, string>[] {
  const fields = new Map(FIELDS[kind].map((f) => [f.key, f]));
  return rows.map((r) => {
    const out: Record<string, string> = {};
    mapping.forEach((key, i) => {
      if (!key || FORBIDDEN_KEYS.includes(key)) return;
      const raw = r[i];
      if (fields.get(key)?.type === 'date') {
        out[key] = parseFlexibleDate(raw) ?? cellToString(raw);
      } else {
        out[key] = cellToString(raw);
      }
    });
    return out;
  });
}

export function missingRequired(mapping: (string | null)[], kind: ImportKind): FieldDef[] {
  return FIELDS[kind].filter((f) => f.required && !mapping.includes(f.key));
}

function csvEscape(v: string) {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV for Polish Excel: semicolon separated with a UTF-8 BOM. */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}

export function templateCsv(kind: ImportKind): string {
  const header = FIELDS[kind].map((f) => f.label);
  const example =
    kind === 'stores'
      ? ['Salon Okien Przykład', '5260001246', 'biuro@przyklad.test', '600 100 200', 'Fikcyjna 1', '00-001', 'Warszawa', 'Anna Przykładowa', '']
      : ['Salon Okien Przykład', 'Jan Testowy', '600 100 200', 'Fikcyjna 1/2', '00-001', 'Warszawa', 'Montaż 2 okien PCV', '12.11.2026', '13.11.2026', '1 dzień', 'Parking od podwórza', '', 'oczekuje', '', 'ZAM-001'];
  return toCsv([header, example]);
}
