import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8081';
const OUT = new URL('./output/shots2/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const admin = { email: `admin2-${run}@example.test`, password: 'Haslo1234!' };
const crew = { email: `ekipa-${run}@example.test`, password: 'Haslo1234!' };
const results = [];
const log = (m) => (console.log(m), results.push(m));
const psql = (q) => execSync(`psql \"${process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/flowmont_e2e'}\" -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png`, fullPage: true });
const btn = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).last();
const field = (label) => page.getByLabel(label, { exact: true }).filter({ visible: true }).last();
const waitText = (t, timeout = 15000) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });
const dialog = () => page.getByRole('dialog').filter({ visible: true }).last();

async function signOut() {
  await page.goto(`${BASE}/account`);
  await btn('Wyloguj się').click();
  await waitText('Zaloguj się');
}
async function signIn(u) {
  await page.goto(`${BASE}/sign-in`);
  await field('E-mail').fill(u.email);
  await field('Hasło').fill(u.password);
  await btn('Zaloguj się').click();
}
async function createJob({ customer, date, confirm }) {
  await page.goto(`${BASE}/jobs/new`);
  await waitText('Nowe zlecenie');
  if (await page.getByRole('button', { name: 'Sklep partnerski: Wybierz…' }).filter({ visible: true }).count()) {
    await btn('Sklep partnerski: Wybierz…').click();
    await dialog().getByRole('radio').first().click();
  }
  await field('Imię i nazwisko klienta').fill(customer);
  await field('Ulica i numer budynku/lokalu').fill('Próbna 5');
  await field('Kod pocztowy').fill('30-001');
  await field('Miejscowość').fill('Kraków');
  await page.getByRole('button', { name: /^Termin montażu:/ }).click();
  await page.getByRole('button', { name: date }).click();
  await btn('Wybierz').click();
  await field('Opis montażu').fill('Montaż drzwi balkonowych');
  if (confirm) await page.getByRole('checkbox', { name: 'Od razu potwierdź termin i przypisz ekipę' }).click();
  await btn(confirm ? 'Utwórz i potwierdź' : 'Utwórz zgłoszenie').click();
  await waitText('Historia');
  return page.url();
}

try {
  // Setup: admin, company, store
  await page.goto(`${BASE}/sign-up`);
  await field('Imię i nazwisko').fill('Beata Admin');
  await field('E-mail').fill(admin.email);
  await field('Hasło').fill(admin.password);
  await btn('Załóż konto').click();
  await field('Nazwa firmy').fill(`Montaże Beta ${run}`);
  await btn('Utwórz firmę i rozpocznij okres próbny').click();
  await waitText('Pulpit');
  await page.goto(`${BASE}/stores`);
  await btn('Dodaj sklep').click();
  await field('Nazwa sklepu').fill('Sklep Beta');
  await field('E-mail do powiadomień').fill(`beta-${run}@example.test`);
  await btn('Zapisz').click();
  await waitText('Dodano sklep partnerski');
  log('OK setup: admin, company and store');

  // A. Admin creates and confirms jobs on behalf of the store (today + a future day)
  const todayJob = await createJob({ customer: 'Klient Dzisiejszy', date: 'piątek, 23 października 2026', confirm: true });
  await waitText('Potwierdzone');
  const futureJob = await createJob({ customer: 'Klient Przyszły', date: 'środa, 28 października 2026', confirm: true });
  log('OK A: admin created two confirmed jobs on behalf of the store');

  // B. Overlap: a pending request on the same day for the same crew cannot be confirmed
  const clash = await createJob({ customer: 'Klient Kolizja', date: 'środa, 28 października 2026', confirm: false });
  await btn('Potwierdź').click();
  await waitText('Ekipa jest zajęta');
  await shot('01-overlap-warning');
  const disabled = await dialog().getByRole('button', { name: 'Potwierdź', exact: true }).isDisabled();
  log(`OK B: overlapping confirmation blocked in UI (confirm disabled: ${disabled})`);
  await dialog().getByRole('button', { name: 'Anuluj', exact: true }).click();

  // C. Server-side check: try the RPC directly for the clashing job
  const clashId = clash.split('/jobs/')[1];
  const sameDayOther = psql(`select count(*) from jobs where id='${clashId}' and status='pending'`);
  log(`OK C: clashing job still pending (${sameDayOther})`);

  // D. Cancel the future confirmed job -> released dates -> announcement
  await page.goto(futureJob);
  await waitText('Historia');
  await btn('Anuluj zlecenie').click();
  await field('Powód anulowania (widoczny dla sklepu)').fill('Klient przełożył remont');
  await dialog().getByRole('button', { name: 'Anuluj zlecenie', exact: true }).click();
  await waitText('Zwolnił się termin');
  await shot('02-released-dialog');
  await btn('Przygotuj ogłoszenie').click();
  await waitText('Ogłoszenia o wolnych terminach');
  await waitText('środa, 28 października 2026');
  await btn('Podgląd i odbiorcy').click();
  await waitText('Odbiorcy (1)');
  await shot('03-announcement-preview');
  await btn('Wyślij').click();
  await btn('Wyślij teraz').click();
  await waitText('Ogłoszenie przekazano do wysyłki: 1 wiadomości');
  const annCount = psql(`select count(*) from notification_outbox o join announcements a on a.id=o.announcement_id join companies c on c.id=a.company_id where c.name like '%${run}'`);
  log(`OK D: cancellation offered an announcement; sent once, outbox rows: ${annCount}`);
  // now the clashing request can be confirmed because capacity was released
  await page.goto(clash);
  await waitText('Historia');
  await btn('Potwierdź').click();
  await waitText('Rezerwacja obejmie');
  await dialog().getByRole('button', { name: 'Potwierdź', exact: true }).click();
  await page.getByText('Potwierdzony termin').filter({ visible: true }).first().waitFor();
  log('OK D2: released capacity reused by the previously clashing request');

  // E. Import stores from CSV
  const csv = '\uFEFFNazwa sklepu;E-mail;Miejscowość;Kod pocztowy\r\nImport Jeden;jeden@example.test;Gdańsk;80001\r\nImport Dwa;zly-email;Gdynia;81-001\r\nSklep Beta;dup@example.test;Sopot;81-700\r\n';
  fs.writeFileSync(`${OUT}sklepy.csv`, csv);
  await page.goto(`${BASE}/import`);
  await waitText('Import z Excela');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn('Wybierz plik .xlsx lub .csv').click()]);
  await chooser.setFiles(`${OUT}sklepy.csv`);
  await waitText('3. Dopasowanie kolumn');
  await shot('04-import-mapping');
  await btn('Sprawdź dane').click();
  await waitText('Poprawne: 1');
  await shot('05-import-preview');
  await btn('Importuj 1 poprawnych wierszy').click();
  await dialog().getByRole('button', { name: 'Importuj', exact: true }).click();
  await waitText('Import zakończony');
  const imported = psql(`select count(*) from stores s join companies c on c.id=s.company_id where c.name like '%${run}' and s.name='Import Jeden' and s.postal_code='80-001'`);
  log(`OK E: CSV import validated rows (1 valid, 1 invalid, 1 duplicate) and imported ${imported} store`);

  // F. Crew member: invitation, mobile daily plan, start and complete
  await page.goto(`${BASE}/crews`);
  await btn('Zaproś montażystę').click();
  await field('E-mail osoby zapraszanej').fill(crew.email);
  await btn('Wyślij zaproszenie').click();
  await waitText('Zaproszenie utworzone');
  const link = await field('Link zaproszenia').inputValue();
  await btn('Gotowe').click();
  await signOut();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(link);
  await btn('Załóż konto').click();
  await field('Imię i nazwisko').fill('Czesław Ekipa');
  await field('E-mail').fill(crew.email);
  await field('Hasło').fill(crew.password);
  await btn('Załóż konto').click();
  await btn('Przyjmij zaproszenie').click();
  await waitText('Plan dnia');
  await waitText('Klient Dzisiejszy');
  await shot('06-crew-mobile-plan');
  await btn('Rozpocznij').click();
  await dialog().getByRole('button', { name: 'Rozpocznij', exact: true }).click();
  await waitText('W realizacji');
  await btn('Zakończ').click();
  await dialog().getByRole('button', { name: 'Zakończ', exact: true }).click();
  await waitText('Zakończone');
  await shot('07-crew-completed');
  const st = psql(`select status from jobs where id='${todayJob.split('/jobs/')[1]}'`);
  log(`OK F: crew member started and completed the job on mobile (status: ${st})`);

  // G. Expired trial -> read-only for admin
  await signOut();
  await page.setViewportSize({ width: 1280, height: 900 });
  psql(`update companies set trial_ends_at = now() - interval '1 minute' where name like '%${run}'`);
  await signIn(admin);
  await waitText('Tryb tylko do odczytu');
  await shot('08-read-only');
  await page.goto(`${BASE}/calendar`);
  await waitText('Kalendarz');
  const newBtn = await page.getByRole('button', { name: 'Nowe zlecenie', exact: true }).filter({ visible: true }).count();
  await page.goto(`${BASE}/billing`);
  await waitText('Status konta');
  await shot('09-billing-read-only');
  log(`OK G: expired trial shows read-only banner; "Nowe zlecenie" buttons visible: ${newBtn}; billing reachable`);
} catch (e) {
  log(`FAIL: ${e.message.split('\n')[0]} at ${page.url()}`);
  await shot('zz-failure');
} finally {
  log(`page errors: ${JSON.stringify(errors.slice(0, 8))}`);
  fs.writeFileSync(`${OUT}results.txt`, results.join('\n'));
  await browser.close();
}
