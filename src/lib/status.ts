import type { IsoDate } from './dates';

export type JobStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';
export type Role = 'admin' | 'store_user' | 'crew_member';

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Oczekuje na akceptację',
  confirmed: 'Potwierdzone',
  in_progress: 'W realizacji',
  completed: 'Zakończone',
  rejected: 'Odrzucone',
  cancelled: 'Anulowane',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  store_user: 'Sklep partnerski',
  crew_member: 'Ekipa montażowa',
};

export const ALL_STATUSES: JobStatus[] = ['pending', 'confirmed', 'in_progress', 'completed', 'rejected', 'cancelled'];

/** Statuses that hold crew capacity. */
export const ACTIVE_STATUSES: JobStatus[] = ['confirmed', 'in_progress'];

/** Allowed transitions (mirrors app.enforce_job_transition in the database). */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type JobAction = 'confirm' | 'reject' | 'cancel' | 'reschedule' | 'start' | 'complete' | 'edit' | 'withdraw';

/**
 * Actions available to a user for a job. The server re-checks everything; this only decides
 * which buttons are shown so the UI never offers an action that would be refused.
 */
export function availableActions(
  job: { status: JobStatus; crew_id: string | null; store_id: string },
  ctx: { role: Role; storeIds: string[]; crewIds: string[]; canWrite: boolean },
): JobAction[] {
  if (!ctx.canWrite) return [];
  const out: JobAction[] = [];
  const s = job.status;
  if (ctx.role === 'admin') {
    if (s === 'pending') out.push('confirm', 'reject', 'edit', 'cancel');
    if (s === 'confirmed') out.push('start', 'reschedule', 'edit', 'cancel');
    if (s === 'in_progress') out.push('complete', 'reschedule', 'edit');
    return out;
  }
  if (ctx.role === 'store_user' && ctx.storeIds.includes(job.store_id)) {
    if (s === 'pending') out.push('edit', 'withdraw');
    return out;
  }
  if (ctx.role === 'crew_member' && job.crew_id && ctx.crewIds.includes(job.crew_id)) {
    if (s === 'confirmed') out.push('start');
    if (s === 'in_progress') out.push('complete');
  }
  return out;
}

/** Dates shown for a job: confirmed range once scheduled, otherwise the requested range. */
export function displayRange(job: {
  status: JobStatus;
  requested_start: IsoDate;
  requested_end: IsoDate;
  confirmed_start: IsoDate | null;
  confirmed_end: IsoDate | null;
}): { start: IsoDate; end: IsoDate; confirmed: boolean } {
  if (job.confirmed_start && job.confirmed_end && job.status !== 'pending' && job.status !== 'rejected') {
    return { start: job.confirmed_start, end: job.confirmed_end, confirmed: true };
  }
  return { start: job.requested_start, end: job.requested_end, confirmed: false };
}
