import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTenant, createUser, expectFailure, inviteAndAccept, pool, sql, submitJob, type Tenant } from './helpers';

let a: Tenant;
let b: Tenant;
let secondStoreId: string;
let secondStoreUser: Awaited<ReturnType<typeof createUser>>;
let jobA: any;
let jobSecondStore: any;
let jobB: any;

beforeAll(async () => {
  a = await createTenant('Okna A');
  b = await createTenant('Okna B');
  const [s2] = await as(a.admin, `insert into public.stores (company_id, name) values ($1, 'Drugi sklep A') returning id`, [a.companyId]);
  secondStoreId = s2.id;
  secondStoreUser = await createUser('store2');
  await inviteAndAccept(a.admin, a.companyId, secondStoreUser, 'store_user', { storeId: secondStoreId });
  jobA = await submitJob(a.storeUser, a.storeId, {}, [{ label: 'Okno salon', width: 1200, height: 1500 }]);
  jobSecondStore = await submitJob(secondStoreUser, secondStoreId, { customer_name: 'Ewa Sekretna' });
  jobB = await submitJob(b.storeUser, b.storeId);
  await sql(
    `insert into storage.objects (bucket_id, name, owner_id) values ('job-files', $1, $2), ('job-files', $3, $4)`,
    [`${a.companyId}/${jobA.id}/x-photo.jpg`, a.storeUser.id, `${b.companyId}/${jobB.id}/y-photo.jpg`, b.storeUser.id],
  );
});

afterAll(async () => {
  await pool.end();
});

describe('tenant isolation', () => {
  it('admin of company A sees only company A jobs', async () => {
    const rows = await as(a.admin, `select id, company_id from public.jobs`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.company_id === a.companyId)).toBe(true);
    expect(rows.map((r) => r.id)).not.toContain(jobB.id);
  });

  it('company B cannot read company A records directly', async () => {
    for (const table of ['jobs', 'stores', 'job_measurements', 'job_activity', 'invitations', 'notification_outbox', 'companies']) {
      const rows = await as(b.admin, `select * from public.${table} where company_id = $1`.replace('where company_id', table === 'companies' ? 'where id' : 'where company_id'), [a.companyId]);
      expect(rows, table).toHaveLength(0);
    }
  });

  it('company B cannot act on company A jobs through RPCs', async () => {
    const err = await expectFailure(as(b.admin, `select public.confirm_job($1)`, [jobA.id]));
    expect(err.hint).toBe('not_found');
    const err2 = await expectFailure(as(b.storeUser, `select public.withdraw_job_request($1)`, [jobA.id]));
    expect(err2.hint).toBe('not_found');
  });

  it('company B cannot create a job for a company A store', async () => {
    const err = await expectFailure(submitJob(b.admin, a.storeId));
    expect(err.hint).toBe('not_found');
  });

  it('company B cannot see company A availability', async () => {
    const err = await expectFailure(as(b.storeUser, `select * from public.get_availability($1, current_date, current_date + 5)`, [a.companyId]));
    expect(err.hint).toBe('not_found');
  });

  it('files are only visible inside the owning company and store', async () => {
    const own = await as(a.storeUser, `select name from storage.objects`);
    expect(own.map((r) => r.name)).toEqual([`${a.companyId}/${jobA.id}/x-photo.jpg`]);
    const other = await as(b.admin, `select name from storage.objects where name like $1`, [`${a.companyId}/%`]);
    expect(other).toHaveLength(0);
    const otherStore = await as(secondStoreUser, `select name from storage.objects`);
    expect(otherStore).toHaveLength(0);
  });

  it('a user cannot upload into another tenant job folder', async () => {
    await expectFailure(
      as(b.admin, `insert into storage.objects (bucket_id, name, owner_id) values ('job-files', $1, $2)`, [
        `${a.companyId}/${jobA.id}/evil.jpg`,
        b.admin.id,
      ]),
    );
    // Even with the right job id, a mismatched company prefix is rejected.
    await expectFailure(
      as(a.storeUser, `insert into storage.objects (bucket_id, name, owner_id) values ('job-files', $1, $2)`, [
        `${b.companyId}/${jobA.id}/evil.jpg`,
        a.storeUser.id,
      ]),
    );
  });

  it('client cannot write jobs directly, bypassing business rules', async () => {
    await expectFailure(as(a.admin, `update public.jobs set status = 'completed' where id = $1`, [jobA.id]));
    await expectFailure(
      as(a.storeUser, `insert into public.jobs (company_id, store_id, reference, customer_name, street, postal_code, city, description, requested_start, requested_end) values ($1, $2, 'X', 'a', 'b', '00-001', 'c', 'd', current_date, current_date)`, [
        b.companyId,
        b.storeId,
      ]),
    );
  });

  it('a store cannot insert a store into another company', async () => {
    await expectFailure(as(a.admin, `insert into public.stores (company_id, name) values ($1, 'Wrogi sklep')`, [b.companyId]));
  });
});

describe('store isolation', () => {
  it('store user sees only their own store and its jobs', async () => {
    const stores = await as(a.storeUser, `select id from public.stores`);
    expect(stores.map((s) => s.id)).toEqual([a.storeId]);
    const jobs = await as(a.storeUser, `select id, customer_name from public.jobs`);
    expect(jobs.map((j) => j.id)).toEqual([jobA.id]);
    expect(jobs.map((j) => j.customer_name)).not.toContain('Ewa Sekretna');
  });

  it('store user cannot read another store job details, measurements or history', async () => {
    expect(await as(a.storeUser, `select * from public.jobs where id = $1`, [jobSecondStore.id])).toHaveLength(0);
    expect(await as(a.storeUser, `select * from public.job_measurements where job_id = $1`, [jobSecondStore.id])).toHaveLength(0);
    expect(await as(a.storeUser, `select * from public.job_activity where job_id = $1`, [jobSecondStore.id])).toHaveLength(0);
    const err = await expectFailure(as(a.storeUser, `select public.update_job_request($1, $2)`, [jobSecondStore.id, JSON.stringify({})]));
    expect(err.hint).toBe('not_found');
  });

  it('store user cannot submit for another store of the same company', async () => {
    const err = await expectFailure(submitJob(a.storeUser, secondStoreId));
    expect(err.hint).toBe('not_found');
  });

  it('store user sees other stores only as anonymous availability', async () => {
    const rows = await as(a.storeUser, `select * from public.get_availability($1, $2::date, $2::date)`, [
      a.companyId,
      jobA.requested_start,
    ]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['blocked', 'busy_crews', 'day', 'pending_requests', 'status', 'total_crews']);
    expect(rows[0].pending_requests).toBeNull();
  });

  it('store user cannot read internal notes or internal activity', async () => {
    await as(a.admin, `insert into public.job_notes (job_id, company_id, is_internal, body) values ($1, $2, true, 'Klient trudny')`, [
      jobA.id,
      a.companyId,
    ]);
    await as(a.admin, `insert into public.job_notes (job_id, company_id, is_internal, body) values ($1, $2, false, 'Wjazd od podwórza')`, [
      jobA.id,
      a.companyId,
    ]);
    const notes = await as(a.storeUser, `select body from public.job_notes where job_id = $1`, [jobA.id]);
    expect(notes.map((n) => n.body)).toEqual(['Wjazd od podwórza']);
    await expectFailure(
      as(a.storeUser, `insert into public.job_notes (job_id, company_id, is_internal, body) values ($1, $2, true, 'x')`, [jobA.id, a.companyId]),
    );
  });

  it('store user cannot see invitations, outbox or other users', async () => {
    expect(await as(a.storeUser, `select * from public.invitations`)).toHaveLength(0);
    expect(await as(a.storeUser, `select * from public.notification_outbox`)).toHaveLength(0);
    const profiles = await as(a.storeUser, `select id from public.profiles`);
    expect(profiles.map((p) => p.id)).toEqual([a.storeUser.id]);
    await expectFailure(as(a.storeUser, `select * from public.company_users($1)`, [a.companyId]));
  });

  it('deactivated store user loses access but history is preserved', async () => {
    const tmp = await createUser('temp-store');
    await inviteAndAccept(a.admin, a.companyId, tmp, 'store_user', { storeId: a.storeId });
    expect((await as(tmp, `select id from public.jobs`)).length).toBeGreaterThan(0);
    await as(a.admin, `select public.set_member_active($1, $2, false)`, [a.companyId, tmp.id]);
    expect(await as(tmp, `select id from public.jobs`)).toHaveLength(0);
    expect((await sql(`select id from public.jobs where id = $1`, [jobA.id])).length).toBe(1);
  });
});

describe('crew visibility', () => {
  it('crew member sees only jobs assigned to their crew', async () => {
    const crewUser = await createUser('crew');
    await inviteAndAccept(a.admin, a.companyId, crewUser, 'crew_member', { crewId: a.defaultCrewId });
    expect(await as(crewUser, `select id from public.jobs`)).toHaveLength(0);
    await as(a.admin, `select public.confirm_job($1)`, [jobA.id]);
    const rows = await as(crewUser, `select id from public.jobs`);
    expect(rows.map((r) => r.id)).toEqual([jobA.id]);
    // Crew members cannot manage company data.
    await expectFailure(as(crewUser, `insert into public.stores (company_id, name) values ($1, 'X')`, [a.companyId]));
    await expectFailure(as(crewUser, `select public.cancel_job($1)`, [jobA.id]));
  });
});

describe('anonymous access', () => {
  it('anonymous users can read nothing', async () => {
    await expectFailure(as(null, `select * from public.jobs`));
    await expectFailure(as(null, `select public.create_company('x')`));
  });

  it('invitation lookup reveals only minimal data', async () => {
    const rows = await as(null, `select * from public.get_invitation('nonexistent')`);
    expect(rows[0].status).toBe('invalid');
  });
});
