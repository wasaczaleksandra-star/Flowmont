import { Platform } from 'react-native';

import { unwrap } from '@/hooks/use-async';
import type { IsoDate } from '@/lib/dates';
import type { JobStatus } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import type { Activity, Attachment, AvailabilityBlock, AvailabilityDay, Crew, Job, JobNote, Measurement, Store } from '@/lib/types';

export const JOB_SELECT = '*, stores(name), crews(name, color)';

export type JobInput = {
  customer_name: string;
  customer_phone: string;
  street: string;
  postal_code: string;
  city: string;
  description: string;
  estimated_duration: string;
  access_instructions: string;
  notes: string;
  requested_start: IsoDate | null;
  requested_end: IsoDate | null;
};

export type MeasurementInput = {
  id?: string;
  label: string;
  width: string;
  height: string;
  unit: 'mm' | 'cm' | 'm';
  quantity: string;
  notes: string;
};

/** Jobs whose requested or confirmed range touches [from, to]. RLS limits rows to what the user may see. */
export async function fetchJobsInRange(companyId: string, from: IsoDate, to: IsoDate, statuses?: JobStatus[]): Promise<Job[]> {
  let q = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('company_id', companyId)
    .or(`and(requested_start.lte.${to},requested_end.gte.${from}),and(confirmed_start.lte.${to},confirmed_end.gte.${from})`)
    .order('requested_start')
    .limit(1000);
  if (statuses && statuses.length) q = q.in('status', statuses);
  return unwrap(q) as Promise<Job[]>;
}

export async function fetchJob(id: string): Promise<Job | null> {
  return unwrap(supabase.from('jobs').select(JOB_SELECT).eq('id', id).maybeSingle()) as Promise<Job | null>;
}

export async function fetchStores(companyId: string, includeInactive = false): Promise<Store[]> {
  let q = supabase.from('stores').select('*').eq('company_id', companyId).order('name');
  if (!includeInactive) q = q.eq('active', true);
  return unwrap(q) as Promise<Store[]>;
}

export async function fetchCrews(companyId: string, includeInactive = false): Promise<Crew[]> {
  let q = supabase.from('crews').select('*').eq('company_id', companyId).order('is_default', { ascending: false }).order('name');
  if (!includeInactive) q = q.eq('active', true);
  return unwrap(q) as Promise<Crew[]>;
}

export async function fetchAvailability(companyId: string, from: IsoDate, to: IsoDate): Promise<AvailabilityDay[]> {
  return unwrap(supabase.rpc('get_availability', { p_company_id: companyId, p_from: from, p_to: to })) as Promise<AvailabilityDay[]>;
}

export async function fetchBlocks(companyId: string, from: IsoDate, to: IsoDate): Promise<AvailabilityBlock[]> {
  return unwrap(
    supabase.from('availability_blocks').select('*').eq('company_id', companyId).lte('start_date', to).gte('end_date', from).order('start_date'),
  ) as Promise<AvailabilityBlock[]>;
}

export async function fetchJobDetails(jobId: string) {
  const [measurements, attachments, notes, activity] = await Promise.all([
    unwrap(supabase.from('job_measurements').select('*').eq('job_id', jobId).order('position')),
    unwrap(supabase.from('job_attachments').select('*').eq('job_id', jobId).order('created_at')),
    unwrap(supabase.from('job_notes').select('*').eq('job_id', jobId).order('created_at')),
    unwrap(supabase.from('job_activity').select('*').eq('job_id', jobId).order('created_at', { ascending: false })),
  ]);
  return {
    measurements: measurements as Measurement[],
    attachments: attachments as Attachment[],
    notes: notes as JobNote[],
    activity: activity as Activity[],
  };
}

export function toJobPayload(v: JobInput) {
  return {
    customer_name: v.customer_name.trim(),
    customer_phone: v.customer_phone.trim() || null,
    street: v.street.trim(),
    postal_code: v.postal_code.trim(),
    city: v.city.trim(),
    description: v.description.trim(),
    estimated_duration: v.estimated_duration.trim() || null,
    access_instructions: v.access_instructions.trim() || null,
    notes: v.notes.trim() || null,
    requested_start: v.requested_start,
    requested_end: v.requested_end ?? v.requested_start,
  };
}

export function toMeasurementPayload(m: MeasurementInput, index: number) {
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  return {
    label: m.label.trim(),
    width: num(m.width),
    height: num(m.height),
    unit: m.unit,
    quantity: m.quantity.trim() === '' ? 1 : Number(m.quantity),
    notes: m.notes.trim() || null,
    position: index,
  };
}

/** Client-side validation mirroring the server (the server stays authoritative). */
export function validateJobInput(v: JobInput, measurements: MeasurementInput[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.customer_name.trim()) e.customer_name = 'Podaj imię i nazwisko klienta.';
  if (v.customer_phone.trim() && !/^\+?[0-9]{9,15}$/.test(v.customer_phone.replace(/[\s\-()]/g, ''))) {
    e.customer_phone = 'Podaj poprawny numer telefonu (np. 600 100 200).';
  }
  if (!v.street.trim()) e.street = 'Podaj ulicę i numer.';
  if (!/^\d{2}-?\d{3}$/.test(v.postal_code.trim())) e.postal_code = 'Kod pocztowy w formacie 00-000.';
  if (!v.city.trim()) e.city = 'Podaj miejscowość.';
  if (!v.description.trim()) e.description = 'Dodaj krótki opis montażu.';
  if (!v.requested_start) e.requested_start = 'Wybierz termin montażu.';
  if (v.requested_start && v.requested_end && v.requested_end < v.requested_start) {
    e.requested_end = 'Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.';
  }
  measurements.forEach((m, i) => {
    const num = (s: string) => s.trim() === '' || (Number.isFinite(Number(s.replace(',', '.'))) && Number(s.replace(',', '.')) > 0);
    if (!m.label.trim()) e[`m${i}.label`] = 'Podaj nazwę pozycji.';
    if (!num(m.width)) e[`m${i}.width`] = 'Podaj dodatnią liczbę.';
    if (!num(m.height)) e[`m${i}.height`] = 'Podaj dodatnią liczbę.';
    if (m.quantity.trim() !== '' && !/^\d{1,3}$/.test(m.quantity.trim())) e[`m${i}.quantity`] = 'Ilość od 1 do 999.';
  });
  return e;
}

// ---------------------------------------------------------------------------
// Workflow actions (all enforced on the server)
// ---------------------------------------------------------------------------
export const jobActions = {
  submit: (storeId: string, job: ReturnType<typeof toJobPayload>, measurements: ReturnType<typeof toMeasurementPayload>[], confirm = false, crewId: string | null = null) =>
    unwrap(
      supabase.rpc('submit_job_request', {
        p_store_id: storeId,
        p_job: job,
        p_measurements: measurements,
        p_confirm: confirm,
        p_crew_id: crewId,
      }),
    ) as Promise<Job>,
  update: (id: string, job: ReturnType<typeof toJobPayload>) => unwrap(supabase.rpc('update_job_request', { p_job_id: id, p_job: job })) as Promise<Job>,
  confirm: (id: string, crewId: string | null, start: IsoDate, end: IsoDate) =>
    unwrap(supabase.rpc('confirm_job', { p_job_id: id, p_crew_id: crewId, p_start: start, p_end: end })) as Promise<Job>,
  reject: (id: string, reason: string) => unwrap(supabase.rpc('reject_job', { p_job_id: id, p_reason: reason || null })) as Promise<Job>,
  cancel: (id: string, reason: string) =>
    unwrap(supabase.rpc('cancel_job', { p_job_id: id, p_reason: reason || null })) as Promise<{ job: Job; released: { start: IsoDate; end: IsoDate } | null }>,
  withdraw: (id: string, reason: string) => unwrap(supabase.rpc('withdraw_job_request', { p_job_id: id, p_reason: reason || null })) as Promise<Job>,
  reschedule: (id: string, start: IsoDate, end: IsoDate, crewId: string | null) =>
    unwrap(supabase.rpc('reschedule_job', { p_job_id: id, p_start: start, p_end: end, p_crew_id: crewId })) as Promise<{
      job: Job;
      released: { start: IsoDate; end: IsoDate } | null;
    }>,
  start: (id: string) => unwrap(supabase.rpc('start_job', { p_job_id: id })) as Promise<Job>,
  complete: (id: string) => unwrap(supabase.rpc('complete_job', { p_job_id: id })) as Promise<Job>,
};

/** Asks the server to deliver queued notifications now (the scheduled job also does this). */
export function kickNotifications() {
  supabase.functions.invoke('process-outbox', { body: {} }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
];

export type PickedFile = { uri: string; name: string; mimeType: string; size: number | null; file?: Blob };

export function validateFile(f: PickedFile): string | null {
  if (!ALLOWED_MIME.includes(f.mimeType)) return `Plik „${f.name}” ma nieobsługiwany format. Dozwolone: zdjęcia (JPG, PNG, WEBP, HEIC), PDF, Excel, Word.`;
  if (f.size != null && f.size > MAX_FILE_BYTES) return `Plik „${f.name}” jest za duży (maks. 20 MB).`;
  if (f.size === 0) return `Plik „${f.name}” jest pusty.`;
  return null;
}

function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80) || 'plik';
}

async function readBody(f: PickedFile): Promise<ArrayBuffer | Blob> {
  if (Platform.OS === 'web' && f.file) return f.file;
  const res = await fetch(f.uri);
  return res.arrayBuffer();
}

/** Uploads one file into the private bucket and records it on the job. */
export async function uploadAttachment(
  job: { id: string; company_id: string },
  f: PickedFile,
  kind: Attachment['kind'],
  userId: string,
  onProgress?: (state: 'uploading' | 'saving') => void,
): Promise<Attachment> {
  const problem = validateFile(f);
  if (problem) throw new Error(problem);
  onProgress?.('uploading');
  const body = await readBody(f);
  const size = f.size ?? (body instanceof ArrayBuffer ? body.byteLength : (body as Blob).size);
  if (size > MAX_FILE_BYTES) throw new Error(`Plik „${f.name}” jest za duży (maks. 20 MB).`);
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${job.company_id}/${job.id}/${Date.now()}-${rand}-${safeFileName(f.name)}`;
  const { error: upErr } = await supabase.storage.from('job-files').upload(path, body, { contentType: f.mimeType, upsert: false });
  if (upErr) {
    throw new Error(/exceeded|too large|413/i.test(upErr.message) ? `Plik „${f.name}” jest za duży.` : `Nie udało się wysłać pliku „${f.name}”.`);
  }
  onProgress?.('saving');
  const { data, error } = await supabase
    .from('job_attachments')
    .insert({
      job_id: job.id,
      company_id: job.company_id,
      storage_path: path,
      file_name: f.name.slice(0, 200),
      mime_type: f.mimeType,
      size_bytes: size,
      kind,
      uploaded_by: userId,
    })
    .select('*')
    .single();
  if (error) {
    await supabase.storage.from('job-files').remove([path]);
    throw error;
  }
  return data as Attachment;
}

/** Short-lived link (10 minutes). Storage policies authorise the request. */
export async function signedUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from('job-files').createSignedUrl(path, 600, download ? { download } : undefined);
  if (error || !data) throw new Error('Nie masz dostępu do tego pliku lub plik nie istnieje.');
  return data.signedUrl;
}

export async function deleteAttachment(a: Attachment) {
  const { error } = await supabase.from('job_attachments').delete().eq('id', a.id);
  if (error) throw error;
  await supabase.storage.from('job-files').remove([a.storage_path]);
}

export function mapsUrl(job: { street: string; postal_code: string; city: string }) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${job.street}, ${job.postal_code} ${job.city}`)}`;
}

export function telUrl(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
