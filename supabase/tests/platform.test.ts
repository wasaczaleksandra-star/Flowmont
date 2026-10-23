import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTenant, createUser, expectFailure, isoDay, pool, sql, submitJob, type Tenant } from './helpers';

let t: Tenant;

beforeAll(async () => {
  t = await createTenant('Platforma');
});

afterAll(async () => {
  await pool.end();
});

describe('registration', () => {
  it('starts a 3-day trial with a default crew', async () => {
    const [c] = await sql(`select trial_ends_at - trial_started_at as len from public.companies where id = $1`, [t.companyId]);
    expect(c.len.days).toBe(3);
    const [access] = await as(t.admin, `select * from public.company_access($1)`, [t.companyId]);
    expect(access.access_level).toBe('full');
    expect(access.subscription_status).toBe('trialing');
  });

  it('prevents accidental duplicate companies', async () => {
    const user = await createUser('dup');
    await as(user, `select public.create_company('Okna Duplikat')`);
    expect((await expectFailure(as(user, `select public.create_company('Okna Duplikat', null, null, true)`))).hint).toBe('duplicate_company');
    expect((await expectFailure(as(user, `select public.create_company('Inna firma')`))).hint).toBe('already_admin');
    const [second] = await as(user, `select * from public.create_company('Inna firma', null, null, true)`);
    expect(second.name).toBe('Inna firma');
  });
});

describe('trial entitlement', () => {
  it('expired trial blocks mutations on the server but keeps data readable', async () => {
    const x = await createTenant('Wygasla');
    const job = await submitJob(x.storeUser, x.storeId);
    await sql(`update public.companies set trial_ends_at = now() - interval '1 minute' where id = $1`, [x.companyId]);

    const [access] = await as(x.admin, `select * from public.company_access($1)`, [x.companyId]);
    expect(access.access_level).toBe('read_only');
    // Data preserved and readable.
    expect(await as(x.admin, `select id from public.jobs`)).toHaveLength(1);
    expect(await as(x.storeUser, `select id from public.jobs`)).toHaveLength(1);
    // Every mutation path is blocked.
    expect((await expectFailure(submitJob(x.storeUser, x.storeId))).hint).toBe('read_only');
    expect((await expectFailure(as(x.admin, `select public.confirm_job($1)`, [job.id]))).hint).toBe('read_only');
    expect((await expectFailure(as(x.admin, `select public.create_invitation($1, 'a@b.pl', 'admin')`, [x.companyId]))).hint).toBe('read_only');
    await expectFailure(as(x.admin, `insert into public.stores (company_id, name) values ($1, 'Nowy')`, [x.companyId]));
    const updated = await as(x.admin, `update public.stores set name = 'Zmiana' where id = $1 returning id`, [x.storeId]);
    expect(updated).toHaveLength(0);
    await expectFailure(
      as(x.admin, `insert into public.job_measurements (job_id, company_id, label) values ($1, $2, 'X')`, [job.id, x.companyId]),
    );

    // An active subscription restores access (webhook path).
    await sql(`select public.apply_billing_event('stripe', 'evt_test_1', 'customer.subscription.updated', $1, '{}'::jsonb, 'active')`, [x.companyId]);
    const [after] = await as(x.admin, `select * from public.company_access($1)`, [x.companyId]);
    expect(after.access_level).toBe('full');
    const [confirmed] = await as(x.admin, `select * from public.confirm_job($1)`, [job.id]);
    expect(confirmed.status).toBe('confirmed');
  });

  it('billing events are applied idempotently', async () => {
    const first = await sql(`select public.apply_billing_event('stripe', 'evt_dup', 'invoice.paid', $1, '{}'::jsonb, 'past_due') as ok`, [t.companyId]);
    const second = await sql(`select public.apply_billing_event('stripe', 'evt_dup', 'invoice.paid', $1, '{}'::jsonb, 'cancelled') as ok`, [t.companyId]);
    expect(first[0].ok).toBe(true);
    expect(second[0].ok).toBe(false);
    const [s] = await sql(`select status from public.subscriptions where company_id = $1`, [t.companyId]);
    expect(s.status).toBe('past_due');
    // past_due keeps access while the provider retries the payment.
    const [access] = await as(t.admin, `select * from public.company_access($1)`, [t.companyId]);
    expect(access.access_level).toBe('full');
    await sql(`update public.subscriptions set status = 'trialing' where company_id = $1`, [t.companyId]);
  });

  it('clients cannot call worker or billing functions', async () => {
    await expectFailure(as(t.admin, `select public.apply_billing_event('stripe', 'x', 'y', $1, '{}'::jsonb, 'active')`, [t.companyId]));
    await expectFailure(as(t.admin, `select * from public.claim_outbox(10)`));
  });

  it('suspended companies are locked for non-admins', async () => {
    const x = await createTenant('Zawieszona');
    const owner = await createUser('owner');
    await sql(`update public.profiles set is_platform_owner = true where id = $1`, [owner.id]);
    await expectFailure(as(x.admin, `select public.platform_set_company_status($1, 'suspended')`, [x.companyId]));
    await as(owner, `select public.platform_set_company_status($1, 'suspended')`, [x.companyId]);
    expect(await as(x.storeUser, `select id from public.stores`)).toHaveLength(0);
    expect((await expectFailure(submitJob(x.admin, x.storeId))).hint).toBe('company_suspended');
    const list = await as(owner, `select * from public.platform_companies()`);
    const row = list.find((r) => r.company_id === x.companyId);
    expect(row.access_level).toBe('suspended');
    // The platform owner does not get job details through table access.
    expect(await as(owner, `select id from public.jobs where company_id = $1`, [x.companyId])).toHaveLength(0);
  });
});

describe('invitations', () => {
  it('only the invited e-mail can accept, once', async () => {
    const invited = await createUser('invited');
    const intruder = await createUser('intruder');
    const [inv] = await as(t.admin, `select public.create_invitation($1, $2, 'store_user', $3) as r`, [t.companyId, invited.email, t.storeId]);
    const token = inv.r.token;
    const [lookup] = await as(null, `select * from public.get_invitation($1)`, [token]);
    expect(lookup.status).toBe('valid');
    expect(lookup.email_hint).not.toBe(invited.email);
    const [mismatch] = await as(intruder, `select * from public.get_invitation($1)`, [token]);
    expect(mismatch.email_matches).toBe(false);
    expect((await expectFailure(as(intruder, `select public.accept_invitation($1)`, [token]))).hint).toBe('invitation_email_mismatch');
    await as(invited, `select public.accept_invitation($1)`, [token]);
    const [again] = await as(invited, `select public.accept_invitation($1) as r`, [token]);
    expect(again.r.already_accepted).toBe(true);
    const companies = await as(invited, `select * from public.my_companies()`);
    expect(companies).toHaveLength(1);
    expect(companies[0].role).toBe('store_user');
    expect(companies[0].store_ids).toEqual([t.storeId]);
    // Only the hash is stored.
    const [row] = await sql(`select token_hash from public.invitations where id = $1`, [inv.r.invitation_id]);
    expect(row.token_hash).not.toBe(token);
  });

  it('expired invitations are rejected with a clear message', async () => {
    const invited = await createUser('late');
    const [inv] = await as(t.admin, `select public.create_invitation($1, $2, 'admin') as r`, [t.companyId, invited.email]);
    await sql(`update public.invitations set expires_at = now() - interval '1 second' where id = $1`, [inv.r.invitation_id]);
    const err = await expectFailure(as(invited, `select public.accept_invitation($1)`, [inv.r.token]));
    expect(err.hint).toBe('invitation_expired');
    expect(err.message).toContain('wygasło');
  });
});

describe('notifications', () => {
  it('outbox keys are idempotent and the claim is exclusive', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(12), requested_end: isoDay(12) });
    const before = await sql(`select count(*)::int as n from public.notification_outbox where job_id = $1`, [job.id]);
    // Re-running the same event for the same activity does not create duplicates.
    await sql(`select app.notify_job_event($1, 'job_requested')`, [job.id]);
    const after = await sql(`select count(*)::int as n from public.notification_outbox where job_id = $1`, [job.id]);
    expect(after[0].n).toBe(before[0].n);

    const c1 = pool.connect();
    const c2 = pool.connect();
    const [a, b] = await Promise.all([c1, c2]);
    try {
      await a.query('begin');
      await b.query('begin');
      const r1 = await a.query(`select id from public.claim_outbox(100)`);
      const r2 = await b.query(`select id from public.claim_outbox(100)`);
      const ids1 = new Set(r1.rows.map((r) => r.id));
      expect(r2.rows.some((r) => ids1.has(r.id))).toBe(false);
      await a.query('rollback');
      await b.query('rollback');
    } finally {
      a.release();
      b.release();
    }
  });

  it('failed deliveries are retried, then marked failed and can be re-queued by an admin', async () => {
    await sql(`update public.notification_outbox set status = 'sent' where status = 'queued'`);
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(13), requested_end: isoDay(13) });
    const [msg] = await sql(`select id from public.notification_outbox where job_id = $1 limit 1`, [job.id]);
    await sql(`update public.notification_outbox set max_attempts = 2 where id = $1`, [msg.id]);
    await sql(`select public.claim_outbox(100)`);
    let [row] = await sql(`select * from public.finish_outbox($1, 'failed', 'resend', null, 'timeout')`, [msg.id]);
    expect(row.status).toBe('queued');
    await sql(`update public.notification_outbox set next_attempt_at = now() where id = $1`, [msg.id]);
    await sql(`select public.claim_outbox(100)`);
    [row] = await sql(`select * from public.finish_outbox($1, 'failed', 'resend', null, 'timeout')`, [msg.id]);
    expect(row.status).toBe('failed');
    expect(row.last_error).toBe('timeout');
    // A late duplicate result never flips a final state.
    [row] = await sql(`select * from public.finish_outbox($1, 'sent', 'resend', 'x')`, [msg.id]);
    expect(row.status).toBe('failed');
    const visible = await as(t.admin, `select status from public.notification_outbox where id = $1`, [msg.id]);
    expect(visible[0].status).toBe('failed');
    const [retried] = await as(t.admin, `select * from public.retry_notification($1)`, [msg.id]);
    expect(retried.status).toBe('queued');
  });

  it('mock deliveries are never marked as sent', async () => {
    const job = await submitJob(t.storeUser, t.storeId, { requested_start: isoDay(14), requested_end: isoDay(14) });
    const [msg] = await sql(`select id from public.notification_outbox where job_id = $1 limit 1`, [job.id]);
    await sql(`update public.notification_outbox set status = 'sending' where id = $1`, [msg.id]);
    const [row] = await sql(`select * from public.finish_outbox($1, 'mocked', 'mock')`, [msg.id]);
    expect(row.status).toBe('mocked');
  });

  it('announcements go only to selected stores and only once', async () => {
    const [s2] = await as(t.admin, `insert into public.stores (company_id, name, email) values ($1, 'Sklep wybrany', 'wybrany@example.test') returning id`, [t.companyId]);
    await as(t.admin, `insert into public.stores (company_id, name, email) values ($1, 'Sklep pominięty', 'pominiety@example.test')`, [t.companyId]);
    const [ann] = await as(t.admin, `select * from public.create_announcement($1, $2::date[], $3::uuid[], $4, true, false)`, [
      t.companyId,
      [isoDay(15)],
      [s2.id],
      'Zwolnił się termin montażu. Sprawdź dostępność i zgłoś zlecenie w Flowmont.',
    ]);
    const preview = await as(t.admin, `select * from public.preview_announcement($1)`, [ann.id]);
    expect(preview.map((p) => p.recipient)).toEqual(['wybrany@example.test']);
    const [sent] = await as(t.admin, `select public.send_announcement($1) as n`, [ann.id]);
    expect(sent.n).toBe(1);
    expect((await expectFailure(as(t.admin, `select public.send_announcement($1)`, [ann.id]))).hint).toBe('already_sent');
    const out = await sql(`select recipient from public.notification_outbox where announcement_id = $1`, [ann.id]);
    expect(out.map((o) => o.recipient)).toEqual(['wybrany@example.test']);
    expect((await expectFailure(as(t.storeUser, `select public.send_announcement($1)`, [ann.id]))).hint).toBe('not_found');
  });
});

describe('import', () => {
  it('validates rows, detects duplicates and imports only into the caller company', async () => {
    const other = await createTenant('Obca');
    const rows = [
      { name: 'Import Sklep 1', email: 'imp1@example.test', postal_code: '30001', company_id: other.companyId },
      { name: 'Import Sklep 1', email: 'imp1b@example.test' },
      { name: '', email: 'zly' },
      { name: 'Import Sklep 2', nip: '123' },
      { name: 'Import Sklep 3', nip: '526-000-12-46' },
    ];
    const [run] = await as(t.admin, `select * from public.import_preview($1, 'stores', 'sklepy.csv', $2)`, [t.companyId, JSON.stringify(rows)]);
    expect(run.total_rows).toBe(5);
    expect(run.valid_rows).toBe(2);
    expect(run.duplicate_rows).toBe(1);
    expect(run.invalid_rows).toBe(2);
    const errors = await as(t.admin, `select row_number, field, message from public.import_row_errors where import_run_id = $1 order by row_number`, [run.id]);
    expect(errors.map((e) => e.row_number)).toEqual([2, 3, 3, 4]);
    // Nothing written before explicit confirmation.
    expect(await sql(`select id from public.stores where name like 'Import Sklep%'`)).toHaveLength(0);

    const [done] = await as(t.admin, `select * from public.import_commit($1)`, [run.id]);
    expect(done.imported_rows).toBe(2);
    const stores = await sql(`select company_id, postal_code from public.stores where name like 'Import Sklep%' order by name`);
    expect(stores).toHaveLength(2);
    expect(stores.every((s) => s.company_id === t.companyId)).toBe(true);
    expect(stores[0].postal_code).toBe('30-001');
    // No invitations were sent automatically.
    expect(await sql(`select id from public.notification_outbox where recipient = 'imp1@example.test'`)).toHaveLength(0);
    expect((await expectFailure(as(t.admin, `select public.import_commit($1)`, [run.id]))).message).toContain('zakończony');
    // Another company's admin cannot read or commit the run.
    expect(await as(other.admin, `select * from public.import_runs where id = $1`, [run.id])).toHaveLength(0);
    expect((await expectFailure(as(other.admin, `select public.import_commit($1)`, [run.id]))).hint).toBe('not_found');
    // A store user cannot import.
    await expectFailure(as(t.storeUser, `select public.import_preview($1, 'stores', 'x', '[]')`, [t.companyId]));
  });

  it('imports jobs for existing stores without notifying anyone', async () => {
    const [store] = await sql(`select name from public.stores where id = $1`, [t.storeId]);
    const rows = [
      { store_name: store.name, customer_name: 'Import Klient', street: 'Testowa 5', postal_code: '00-001', city: 'Kraków', description: 'Okna', requested_start: isoDay(100), external_ref: 'EXT-1' },
      { store_name: 'Nie istnieje', customer_name: 'X', street: 'Y', postal_code: '00-001', city: 'Z', description: 'D', requested_start: isoDay(100) },
      { store_name: store.name, customer_name: 'Inny', street: 'Testowa 6', postal_code: '00-001', city: 'Kraków', description: 'Okna', requested_start: 'zła data' },
      { store_name: store.name, customer_name: 'Duplikat', street: 'Testowa 7', postal_code: '00-001', city: 'Kraków', description: 'Okna', requested_start: isoDay(100), external_ref: 'EXT-1' },
    ];
    const [run] = await as(t.admin, `select * from public.import_preview($1, 'jobs', 'zlecenia.xlsx', $2)`, [t.companyId, JSON.stringify(rows)]);
    expect([run.valid_rows, run.invalid_rows, run.duplicate_rows]).toEqual([1, 2, 1]);
    const outboxBefore = await sql(`select count(*)::int as n from public.notification_outbox`);
    const [done] = await as(t.admin, `select * from public.import_commit($1)`, [run.id]);
    expect(done.imported_rows).toBe(1);
    const [job] = await sql(`select status, company_id from public.jobs where external_ref = 'EXT-1'`);
    expect(job).toEqual({ status: 'pending', company_id: t.companyId });
    const outboxAfter = await sql(`select count(*)::int as n from public.notification_outbox`);
    expect(outboxAfter[0].n).toBe(outboxBefore[0].n);
  });
});

describe('demo safety and plan order', () => {
  it('demo companies never queue real deliveries', async () => {
    const d = await createTenant('Demo');
    await sql(`update public.companies set is_demo = true where id = $1`, [d.companyId]);
    const job = await submitJob(d.storeUser, d.storeId);
    const rows = await sql(`select status from public.notification_outbox where job_id = $1`, [job.id]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'mocked')).toBe(true);
    // Clients cannot flip the demo flag.
    await expectFailure(as(d.admin, `update public.companies set is_demo = false where id = $1`, [d.companyId]));
  });

  it('plan order can only reference jobs of the same company', async () => {
    const x = await createTenant('Plan');
    const y = await createTenant('PlanObcy');
    const jx = await submitJob(x.storeUser, x.storeId, { requested_start: isoDay(3), requested_end: isoDay(3) });
    const jy = await submitJob(y.storeUser, y.storeId, { requested_start: isoDay(3), requested_end: isoDay(3) });
    await as(x.admin, `select public.set_plan_order($1, $2::date, $3::uuid[])`, [x.companyId, isoDay(3), [jx.id]]);
    expect((await expectFailure(as(x.admin, `select public.set_plan_order($1, $2::date, $3::uuid[])`, [x.companyId, isoDay(3), [jy.id]]))).hint).toBe('not_found');
    expect((await expectFailure(as(x.storeUser, `select public.set_plan_order($1, $2::date, $3::uuid[])`, [x.companyId, isoDay(3), [jx.id]]))).hint).toBe('forbidden');
  });
});
