#!/usr/bin/env node
// Creates an isolated demo workspace with fictional data (companies, stores, users, crews,
// jobs in every status, multi-day jobs, measurements and sample attachments).
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-demo.mjs [--reset]
//
// * Every demo company has is_demo = true: its notifications are never delivered.
// * Demo logins use the reserved .test domain, so no real mailbox can receive anything.
// * --reset removes ONLY previous demo companies (is_demo = true) and demo users (@demo.flowmont.test).
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side secret, never commit it).');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Flowmont-2026';
const DOMAIN = 'demo.flowmont.test';

const must = async (p, what) => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

function day(offset) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  return d.toISOString().slice(0, 10);
}

async function reset() {
  const companies = await must(db.from('companies').select('id').eq('is_demo', true), 'list demo companies');
  for (const c of companies) {
    await must(db.from('jobs').delete().eq('company_id', c.id), 'delete demo jobs');
    await must(db.from('companies').delete().eq('id', c.id), 'delete demo company');
  }
  let page = 1;
  for (;;) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    for (const u of users.filter((x) => x.email?.endsWith(`@${DOMAIN}`))) await db.auth.admin.deleteUser(u.id);
    if (users.length < 200) break;
    page += 1;
  }
  console.log(`Removed ${companies.length} demo companies and demo users.`);
}

async function user(local, fullName) {
  const email = `${local}@${DOMAIN}`;
  const data = await must(db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }), `create ${email}`);
  return { id: data.user.id, email };
}

async function seedCompany({ name, prefix, stores, crews }) {
  const admin = await user(`${prefix}.admin`, 'Anna Demo (administrator)');
  const company = await must(
    db
      .from('companies')
      .insert({ name, is_demo: true, created_by: admin.id, trial_ends_at: new Date(Date.now() + 365 * 86400_000).toISOString(), email: admin.email })
      .select()
      .single(),
    'company',
  );
  await must(db.from('company_members').insert({ company_id: company.id, user_id: admin.id, role: 'admin' }), 'admin member');
  await must(db.from('subscriptions').insert({ company_id: company.id, status: 'trialing' }), 'subscription');
  const crewRows = await must(
    db.from('crews').insert(crews.map((c, i) => ({ company_id: company.id, name: c, is_default: i === 0, color: ['#2F8EE0', '#EC6206'][i % 2] }))).select(),
    'crews',
  );
  const storeRows = await must(db.from('stores').insert(stores.map((s) => ({ company_id: company.id, ...s }))).select(), 'stores');

  const storeUsers = [];
  for (const [i, s] of storeRows.entries()) {
    const u = await user(`${prefix}.sklep${i + 1}`, `Sklep demo ${i + 1}`);
    await must(db.from('company_members').insert({ company_id: company.id, user_id: u.id, role: 'store_user' }), 'store member');
    await must(db.from('store_members').insert({ store_id: s.id, company_id: company.id, user_id: u.id }), 'store link');
    storeUsers.push(u);
  }
  const crewUser = await user(`${prefix}.ekipa`, 'Piotr Demo (ekipa)');
  await must(db.from('company_members').insert({ company_id: company.id, user_id: crewUser.id, role: 'crew_member' }), 'crew member');
  await must(db.from('crew_members').insert({ crew_id: crewRows[0].id, company_id: company.id, user_id: crewUser.id }), 'crew link');
  return { company, admin, crewRows, storeRows, storeUsers, crewUser };
}

let refSeq = 0;
async function job(ctx, spec) {
  refSeq += 1;
  const year = new Date().getFullYear();
  const base = {
    company_id: ctx.company.id,
    store_id: ctx.storeRows[spec.store ?? 0].id,
    reference: `FM-${year}-${String(900 + refSeq).padStart(4, '0')}`,
    status: spec.status,
    customer_name: spec.customer,
    customer_phone: '600 000 000',
    street: spec.street,
    postal_code: spec.postal,
    city: spec.city,
    description: spec.description,
    estimated_duration: spec.duration ?? null,
    access_instructions: spec.access ?? null,
    requested_start: day(spec.start),
    requested_end: day(spec.end ?? spec.start),
    created_by: ctx.storeUsers[spec.store ?? 0].id,
  };
  if (['confirmed', 'in_progress', 'completed', 'cancelled'].includes(spec.status) && spec.crew !== undefined) {
    Object.assign(base, { crew_id: ctx.crewRows[spec.crew].id, confirmed_start: base.requested_start, confirmed_end: base.requested_end });
  }
  if (spec.status === 'rejected') base.rejection_reason = 'Brak wolnej ekipy w tym terminie (dane demo).';
  if (spec.status === 'cancelled') base.cancellation_reason = 'Klient przełożył remont (dane demo).';
  if (spec.status === 'completed') Object.assign(base, { started_at: new Date().toISOString(), completed_at: new Date().toISOString() });
  const row = await must(db.from('jobs').insert(base).select().single(), `job ${spec.customer}`);
  if (spec.measurements) {
    await must(
      db.from('job_measurements').insert(spec.measurements.map((m, i) => ({ job_id: row.id, company_id: row.company_id, position: i, unit: 'mm', quantity: 1, ...m }))),
      'measurements',
    );
  }
  const history = [{ action: 'created', details: { start: base.requested_start, end: base.requested_end } }];
  if (base.confirmed_start) history.push({ action: 'confirmed', details: { start: base.confirmed_start, end: base.confirmed_end, crew_name: ctx.crewRows[spec.crew].name } });
  if (spec.status === 'in_progress' || spec.status === 'completed') history.push({ action: 'started', details: {} });
  if (spec.status === 'completed') history.push({ action: 'completed', details: {} });
  if (spec.status === 'rejected') history.push({ action: 'rejected', details: { reason: base.rejection_reason } });
  if (spec.status === 'cancelled') history.push({ action: 'cancelled', details: { reason: base.cancellation_reason } });
  await must(
    db.from('job_activity').insert(history.map((h) => ({ job_id: row.id, company_id: row.company_id, actor_name: 'Dane demo', ...h }))),
    'activity',
  );
  return row;
}

async function attach(row, fileName, bytes, type) {
  const path = `${row.company_id}/${row.id}/demo-${fileName}`;
  const { error } = await db.storage.from('job-files').upload(path, bytes, { contentType: type, upsert: true });
  if (error) {
    console.warn(`  (pominięto załącznik ${fileName}: ${error.message})`);
    return;
  }
  await must(
    db.from('job_attachments').insert({ job_id: row.id, company_id: row.company_id, storage_path: path, file_name: fileName, mime_type: type, size_bytes: bytes.length, kind: type.startsWith('image/') ? 'photo' : 'measurement_doc' }),
    'attachment',
  );
}

if (process.argv.includes('--reset')) await reset();

const a = await seedCompany({
  name: 'Okna Demo – Montaże (dane fikcyjne)',
  prefix: 'okna',
  crews: ['Ekipa Północ', 'Ekipa Południe'],
  stores: [
    { name: 'Salon Okien Demo Centrum', email: `salon.centrum@${DOMAIN}`, city: 'Warszawa', postal_code: '00-001', street: 'Przykładowa 1' },
    { name: 'Drzwi i Okna Demo Mokotów', email: `mokotow@${DOMAIN}`, city: 'Warszawa', postal_code: '02-001', street: 'Testowa 10' },
    { name: 'Market Budowlany Demo', email: `market@${DOMAIN}`, city: 'Piaseczno', postal_code: '05-500', street: 'Fikcyjna 7' },
  ],
});
const win = [{ label: 'Okno salon', width: 1465, height: 1435 }, { label: 'Okno kuchnia', width: 865, height: 1135 }];
const j1 = await job(a, { status: 'pending', customer: 'Jan Przykładowy', street: 'Lipowa 3/4', postal: '00-950', city: 'Warszawa', description: 'Montaż 2 okien PCV z demontażem starych', start: 5, store: 0, measurements: win, access: 'Domofon 12, parking pod blokiem' });
await job(a, { status: 'pending', customer: 'Ewa Testowa', street: 'Brzozowa 8', postal: '02-777', city: 'Warszawa', description: 'Drzwi balkonowe HST', start: 5, store: 1, duration: '1 dzień' });
const j3 = await job(a, { status: 'confirmed', customer: 'Marek Fikcyjny', street: 'Klonowa 15', postal: '05-500', city: 'Piaseczno', description: 'Wymiana 6 okien w domu jednorodzinnym', start: 2, end: 4, crew: 0, store: 2, duration: '3 dni', measurements: [...win, { label: 'Okno poddasze', width: 780, height: 1180, quantity: 2 }] });
await job(a, { status: 'confirmed', customer: 'Zofia Demo', street: 'Dębowa 2', postal: '00-120', city: 'Warszawa', description: 'Montaż rolet zewnętrznych', start: 3, crew: 1, store: 0 });
await job(a, { status: 'in_progress', customer: 'Tomasz Próbny', street: 'Jesionowa 9/1', postal: '01-200', city: 'Warszawa', description: 'Montaż drzwi wejściowych', start: 0, crew: 1, store: 1, access: 'Wejście od podwórza' });
await job(a, { status: 'completed', customer: 'Alicja Wzór', street: 'Sosnowa 4', postal: '00-300', city: 'Warszawa', description: 'Okna dachowe – 2 szt.', start: -3, crew: 0, store: 0 });
await job(a, { status: 'rejected', customer: 'Robert Szablon', street: 'Grabowa 11', postal: '00-400', city: 'Warszawa', description: 'Witryna sklepowa', start: 4, store: 2 });
await job(a, { status: 'cancelled', customer: 'Karolina Przykład', street: 'Akacjowa 6', postal: '00-500', city: 'Warszawa', description: 'Parapety zewnętrzne', start: 8, crew: 0, store: 1 });
await job(a, { status: 'confirmed', customer: 'Paweł Demo', street: 'Wierzbowa 20', postal: '05-500', city: 'Piaseczno', description: 'Elewacja – stolarka aluminiowa', start: 9, end: 12, crew: 1, store: 2, duration: '4 dni' });
await db.from('availability_blocks').insert({ company_id: a.company.id, start_date: day(14), end_date: day(14), reason: 'Szkolenie (dane demo)' });

let sample = null;
try {
  sample = readFileSync(new URL('../assets/images/icon.png', import.meta.url));
} catch {}
if (sample) {
  await attach(j1, 'zdjecie-otworu.png', sample, 'image/png');
  await attach(j3, 'karta-pomiaru.png', sample, 'image/png');
}

const b = await seedCompany({
  name: 'Drzwi Demo – druga firma (dane fikcyjne)',
  prefix: 'drzwi',
  crews: ['Ekipa 1'],
  stores: [{ name: 'Sklep Demo Kraków', email: `krakow@${DOMAIN}`, city: 'Kraków', postal_code: '30-001', street: 'Przykładowa 5' }],
});
await job(b, { status: 'confirmed', customer: 'Kamil Fikcyjny', street: 'Długa 1', postal: '30-002', city: 'Kraków', description: 'Drzwi wewnętrzne – 5 szt.', start: 2, crew: 0 });

console.log('\nDemo gotowe. Hasło dla wszystkich kont demo:', PASSWORD);
for (const u of [a.admin, ...a.storeUsers, a.crewUser, b.admin, ...b.storeUsers, b.crewUser]) console.log(' -', u.email);
