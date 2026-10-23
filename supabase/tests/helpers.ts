import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:54329/flowmont_test?host=/tmp';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

export type User = { id: string; email: string };

/** Runs SQL as the database owner (bypasses RLS) – fixtures and assertions only. */
export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/** Runs one statement as an authenticated Supabase user in its own transaction. */
export async function as<T = any>(user: User | null, text: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${user ? 'authenticated' : 'anon'}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(user ? { sub: user.id, role: 'authenticated', email: user.email } : { role: 'anon' }),
    ]);
    const res = await client.query(text, params);
    await client.query('commit');
    return res.rows as T[];
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Opens a transaction as a user and keeps it open (for concurrency tests). */
export async function openTx(user: User) {
  const client = await pool.connect();
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email }),
  ]);
  return {
    query: (text: string, params: unknown[] = []) => client.query(text, params),
    commit: async () => {
      await client.query('commit');
      client.release();
    },
    rollback: async () => {
      await client.query('rollback');
      client.release();
    },
  };
}

export async function createUser(prefix = 'user'): Promise<User> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
  const [row] = await sql<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: prefix })],
  );
  return { id: row.id, email };
}

export function isoDay(offset: number): string {
  const now = new Date();
  // Europe/Warsaw "today" is close enough to UTC for offsets of several days.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
}

export type Tenant = {
  admin: User;
  companyId: string;
  defaultCrewId: string;
  storeId: string;
  storeUser: User;
};

/** Company with an admin (created through the public RPC), a store and an invited store user. */
export async function createTenant(name = 'Firma'): Promise<Tenant> {
  const admin = await createUser('admin');
  const [company] = await as(admin, `select * from public.create_company($1)`, [`${name} ${randomUUID().slice(0, 6)}`]);
  const [crew] = await sql(`select id from public.crews where company_id = $1 and is_default`, [company.id]);
  const [store] = await as(admin, `insert into public.stores (company_id, name, email) values ($1, $2, $3) returning id`, [
    company.id,
    `Sklep ${randomUUID().slice(0, 6)}`,
    `sklep-${randomUUID().slice(0, 6)}@example.test`,
  ]);
  const storeUser = await createUser('store');
  await inviteAndAccept(admin, company.id, storeUser, 'store_user', { storeId: store.id });
  return { admin, companyId: company.id, defaultCrewId: crew.id, storeId: store.id, storeUser };
}

export async function inviteAndAccept(
  admin: User,
  companyId: string,
  user: User,
  role: 'admin' | 'store_user' | 'crew_member',
  opts: { storeId?: string; crewId?: string } = {},
) {
  const [inv] = await as(admin, `select public.create_invitation($1, $2, $3, $4, $5) as r`, [
    companyId,
    user.email,
    role,
    opts.storeId ?? null,
    opts.crewId ?? null,
  ]);
  await as(user, `select public.accept_invitation($1)`, [inv.r.token]);
  return inv.r.token as string;
}

export function jobPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Jan Testowy',
    customer_phone: '600 100 200',
    street: 'Fikcyjna 1/2',
    postal_code: '00950',
    city: 'Warszawa',
    description: 'Montaż 2 okien PCV',
    requested_start: isoDay(10),
    requested_end: isoDay(10),
    ...overrides,
  };
}

export async function submitJob(user: User, storeId: string, overrides: Record<string, unknown> = {}, measurements: unknown[] = []) {
  const [job] = await as(user, `select * from public.submit_job_request($1, $2, $3)`, [
    storeId,
    JSON.stringify(jobPayload(overrides)),
    JSON.stringify(measurements),
  ]);
  return job;
}

/** Error message (Polish) and hint (machine code) of a failed call. */
export async function expectFailure(p: Promise<unknown>): Promise<{ message: string; hint?: string; code?: string }> {
  try {
    await p;
  } catch (e: any) {
    return { message: e.message, hint: e.hint, code: e.code };
  }
  throw new Error('Expected the call to fail, but it succeeded');
}
