import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createTenant,
  createUser,
  expectFailure,
  inviteAndAccept,
  isoDay,
  openTx,
  pool,
  sql,
  submitJob,
  type Tenant,
} from './helpers';

let t: Tenant;
let crew2: string;
let crewUser: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  t = await createTenant('Workflow');
  const [c] = await as(t.admin, `insert into public.crews (company_id, name) values ($1, 'Ekipa 2') returning id`, [t.companyId]);
  crew2 = c.id;
  crewUser = await createUser('crew');
  await inviteAndAccept(t.admin, t.companyId, crewUser, 'crew_member', { crewId: t.defaultCrewId });
});

afterAll(async () => {
  await pool.end();
});

describe('booking request', () => {
  it('store submits a single-day request with customer data and measurements', async () => {
    const job = await submitJob(t.storeUser, t.storeId, {}, [
      { label: 'Okno kuchnia', width: 900, height: 1200, quantity: 2 },
      { label: 'Drzwi balkonowe', width: 800, height: 2100 },
    ]);
    expect(job.status).toBe('pending');
    expect(job.reference).toMatch(/^FM-\d{4}-\d{4}$/);
    expect(job.postal_code).toBe('00-950');
    const m = await as(t.storeUser, `select label, unit, quantity from public.job_measurements where job_id = $1 order by position`, [job.id]);
    expect(m).toEqual([
      { label: 'Okno kuchnia', unit: 'mm', quantity: 2 },
      { label: 'Drzwi balkonowe', unit: 'mm', quantity: 1 },
    ]);
    const activity = await as(t.storeUser, `select action from public.job_activity where job_id = $1`, [job.id]);
    expect(activity.map((a) => a.action)).toEqual(['created']);
    const outbox = await sql(`select event_type, recipient, body from public.notification_outbox where job_id = $1`, [job.id]);
    expect(outbox.map((o) => o.event_type)).toEqual(['job_requested']);
    expect(outbox[0].recipient).toBe(t.admin.email);
    // Minimal personal data: no customer name or phone in the message.
    expect(outbox[0].body).not.toContain('Jan Testowy');
    expect(outbox[0].body).not.toContain('600 100 200');
  });

  it('validates required fields and dates with Polish messages', async () => {
    let err = await expectFailure(submitJob(t.storeUser, t.storeId, { customer_name: '' }));
    expect(err.message).toBe('Podaj imię i nazwisko klienta.');
    err = await expectFailure(submitJob(t.storeUser, t.storeId, { postal_code: 'abc' }));
    expect(err.message).toContain('kod pocztowy');
    err = await expectFailure(submitJob(t.storeUser, t.storeId, { requested_start: isoDay(5), requested_end: isoDay(3) }));
    expect(err.message).toContain('Data zakończenia');
    err = await expectFailure(submitJob(t.storeUser, t.storeId, { requested_start: isoDay(-5), requested_end: isoDay(-5) }));
    expect(err.message).toContain('przeszłości');
  });

  it('store can edit and withdraw only pending requests', async () => {
    const job = await submitJob(t.storeUser, t.storeId);
    const [edited] = await as(t.storeUser, `select * from public.update_job_request($1, $2)`, [
      job.id,
      JSON.stringify({ ...job, description: 'Zmieniony opis' }),
    ]);
    expect(edited.description).toBe('Zmieniony opis');
    await as(t.admin, `select public.confirm_job($1)`, [job.id]);
    const err = await expectFailure(
      as(t.storeUser, `select public.update_job_request($1, $2)`, [job.id, JSON.stringify({ ...job, description: 'X' })]),
    );
    expect(err.hint).toBe('locked');
    const err2 = await expectFailure(as(t.storeUser, `select public.withdraw_job_request($1)`, [job.id]));
    expect(err2.hint).toBe('locked');
  });
});

describe('status transitions', () => {
  it('follows pending → confirmed → in_progress → completed', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(20), requested_end: isoDay(20) });
    const [c] = await as(t.admin, `select * from public.confirm_job($1, $2)`, [job.id, t.defaultCrewId]);
    expect(c.status).toBe('confirmed');
    expect(c.crew_id).toBe(t.defaultCrewId);
    const [s] = await as(crewUser, `select * from public.start_job($1)`, [job.id]);
    expect(s.status).toBe('in_progress');
    const [d] = await as(crewUser, `select * from public.complete_job($1)`, [job.id]);
    expect(d.status).toBe('completed');
    const history = await as(t.admin, `select action from public.job_activity where job_id = $1 order by id`, [job.id]);
    expect(history.map((h) => h.action)).toEqual(['created', 'confirmed', 'started', 'completed']);
    // Completed jobs stay in history and cannot be reopened or cancelled.
    expect((await expectFailure(as(t.admin, `select public.cancel_job($1)`, [job.id]))).hint).toBe('invalid_transition');
  });

  it('rejects disallowed transitions', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(21), requested_end: isoDay(21) });
    expect((await expectFailure(as(t.admin, `select public.start_job($1)`, [job.id]))).hint).toBe('invalid_transition');
    expect((await expectFailure(as(t.admin, `select public.complete_job($1)`, [job.id]))).hint).toBe('invalid_transition');
    const [r] = await as(t.admin, `select * from public.reject_job($1, 'Brak materiału')`, [job.id]);
    expect(r.status).toBe('rejected');
    expect(r.rejection_reason).toBe('Brak materiału');
    expect((await expectFailure(as(t.admin, `select public.confirm_job($1)`, [job.id]))).hint).toBe('invalid_transition');
  });

  it('only admins approve, reject and cancel; stores cannot', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(22), requested_end: isoDay(22) });
    expect((await expectFailure(as(t.storeUser, `select public.confirm_job($1)`, [job.id]))).hint).toBe('forbidden');
    expect((await expectFailure(as(t.storeUser, `select public.reject_job($1)`, [job.id]))).hint).toBe('forbidden');
    expect((await expectFailure(as(t.storeUser, `select public.cancel_job($1)`, [job.id]))).hint).toBe('forbidden');
    expect((await expectFailure(as(crewUser, `select public.confirm_job($1)`, [job.id]))).hint).toBe('not_found');
  });

  it('crew members can only start jobs of their own crew', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(23), requested_end: isoDay(23) });
    await as(t.admin, `select public.confirm_job($1, $2)`, [job.id, crew2]);
    expect((await expectFailure(as(crewUser, `select public.start_job($1)`, [job.id]))).hint).toBe('not_found');
  });
});

describe('capacity and overlap', () => {
  it('multi-day booking occupies every day of the range', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(30), requested_end: isoDay(32) });
    await as(t.admin, `select public.confirm_job($1, $2)`, [job.id, t.defaultCrewId]);
    const days = await as(t.admin, `select day::text, busy_crews from public.get_availability($1, $2::date, $3::date)`, [
      t.companyId,
      isoDay(29),
      isoDay(33),
    ]);
    expect(days.map((d) => d.busy_crews)).toEqual([0, 1, 1, 1, 0]);
    // Overlap on the last day is rejected for the same crew.
    const other = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(32), requested_end: isoDay(33) });
    const err = await expectFailure(as(t.admin, `select public.confirm_job($1, $2)`, [other.id, t.defaultCrewId]));
    expect(err.hint).toBe('crew_conflict');
    // A different crew can take the same dates.
    const [ok] = await as(t.admin, `select * from public.confirm_job($1, $2)`, [other.id, crew2]);
    expect(ok.status).toBe('confirmed');
    const full = await as(t.storeUser, `select status from public.get_availability($1, $2::date, $2::date)`, [t.companyId, isoDay(32)]);
    expect(full[0].status).toBe('full');
  });

  it('pending requests may overlap and do not reserve capacity', async () => {
    const j1 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(40), requested_end: isoDay(40) });
    const j2 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(40), requested_end: isoDay(40) });
    const [day] = await as(t.admin, `select * from public.get_availability($1, $2::date, $2::date)`, [t.companyId, isoDay(40)]);
    expect(day.busy_crews).toBe(0);
    expect(day.pending_requests).toBe(2);
    await as(t.admin, `select public.confirm_job($1, $2)`, [j1.id, t.defaultCrewId]);
    expect((await expectFailure(as(t.admin, `select public.confirm_job($1, $2)`, [j2.id, t.defaultCrewId]))).hint).toBe('crew_conflict');
  });

  it('concurrent confirmations for the same crew and date cannot both succeed', async () => {
    const j1 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(50), requested_end: isoDay(51) });
    const j2 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(51), requested_end: isoDay(52) });
    const tx1 = await openTx(t.admin);
    const tx2 = await openTx(t.admin);
    await tx1.query(`select public.confirm_job($1, $2)`, [j1.id, t.defaultCrewId]);
    // The second transaction blocks on the crew lock until the first commits, then fails.
    const second = tx2.query(`select public.confirm_job($1, $2)`, [j2.id, t.defaultCrewId]).then(
      () => 'ok',
      (e: any) => e.hint ?? e.code,
    );
    await new Promise((r) => setTimeout(r, 150));
    await tx1.commit();
    const result = await second;
    await (result === 'ok' ? tx2.commit() : tx2.rollback());
    expect(result).toBe('crew_conflict');
    const confirmed = await sql(`select id from public.jobs where id in ($1, $2) and status = 'confirmed'`, [j1.id, j2.id]);
    expect(confirmed).toHaveLength(1);
  });

  it('the exclusion constraint blocks double booking even without the RPC checks', async () => {
    const j1 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(60), requested_end: isoDay(60) });
    const j2 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(60), requested_end: isoDay(60) });
    await sql(`update public.jobs set status='confirmed', crew_id=$2, confirmed_start=requested_start, confirmed_end=requested_end where id=$1`, [
      j1.id,
      crew2,
    ]);
    const err = await expectFailure(
      sql(`update public.jobs set status='confirmed', crew_id=$2, confirmed_start=requested_start, confirmed_end=requested_end where id=$1`, [
        j2.id,
        crew2,
      ]),
    );
    expect(err.code).toBe('23P01');
  });

  it('blocked dates prevent confirmations and blocks cannot cover confirmed jobs', async () => {
    await as(t.admin, `select public.create_availability_block($1, $2::date, $3::date, null, 'Urlop')`, [t.companyId, isoDay(70), isoDay(71)]);
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(71), requested_end: isoDay(72) });
    expect((await expectFailure(as(t.admin, `select public.confirm_job($1, $2)`, [job.id, crew2]))).hint).toBe('date_blocked');
    const [day] = await as(t.storeUser, `select status from public.get_availability($1, $2::date, $2::date)`, [t.companyId, isoDay(70)]);
    expect(day.status).toBe('blocked');
    const other = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(75), requested_end: isoDay(75) });
    await as(t.admin, `select public.confirm_job($1, $2)`, [other.id, crew2]);
    const err = await expectFailure(as(t.admin, `select public.create_availability_block($1, $2::date, $2::date, $3)`, [t.companyId, isoDay(75), crew2]));
    expect(err.hint).toBe('block_conflict');
    // Store users cannot see block reasons.
    expect(await as(t.storeUser, `select * from public.availability_blocks`)).toHaveLength(0);
  });

  it('rescheduling validates capacity, keeps attachments and records history', async () => {
    const j1 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(80), requested_end: isoDay(80) });
    const j2 = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(82), requested_end: isoDay(82) });
    await as(t.admin, `select public.confirm_job($1, $2)`, [j1.id, t.defaultCrewId]);
    await as(t.admin, `select public.confirm_job($1, $2)`, [j2.id, t.defaultCrewId]);
    await sql(
      `insert into public.job_attachments (job_id, company_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, $3, 'a.jpg', 'image/jpeg', 100)`,
      [j1.id, t.companyId, `${t.companyId}/${j1.id}/a.jpg`],
    );
    const err = await expectFailure(as(t.admin, `select public.reschedule_job($1, $2::date, $2::date)`, [j1.id, isoDay(82)]));
    expect(err.hint).toBe('crew_conflict');
    const [res] = await as(t.admin, `select public.reschedule_job($1, $2::date, $3::date) as r`, [j1.id, isoDay(84), isoDay(85)]);
    expect(res.r.job.confirmed_start).toBe(isoDay(84));
    expect(res.r.released.start).toBe(isoDay(80));
    const files = await as(t.storeUser, `select file_name from public.job_attachments where job_id = $1`, [j1.id]);
    expect(files).toHaveLength(1);
    const [act] = await as(t.storeUser, `select details from public.job_activity where job_id = $1 and action = 'rescheduled'`, [j1.id]);
    expect(act.details.to_start).toBe(isoDay(84));
    const events = await sql(`select distinct event_type from public.notification_outbox where job_id = $1`, [j1.id]);
    expect(events.map((e) => e.event_type).sort()).toEqual(['date_released', 'job_confirmed', 'job_requested', 'job_rescheduled']);
  });

  it('cancellation releases capacity and reports the released dates', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(90), requested_end: isoDay(91) });
    await as(t.admin, `select public.confirm_job($1, $2)`, [job.id, t.defaultCrewId]);
    const [res] = await as(t.admin, `select public.cancel_job($1, 'Klient zrezygnował') as r`, [job.id]);
    expect(res.r.released).toMatchObject({ start: isoDay(90), end: isoDay(91) });
    const days = await as(t.admin, `select busy_crews from public.get_availability($1, $2::date, $3::date)`, [t.companyId, isoDay(90), isoDay(91)]);
    expect(days.every((d) => d.busy_crews === 0)).toBe(true);
    // Capacity is free again for a new confirmation.
    const again = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(90), requested_end: isoDay(90) });
    const [c] = await as(t.admin, `select * from public.confirm_job($1, $2)`, [again.id, t.defaultCrewId]);
    expect(c.status).toBe('confirmed');
  });
});
