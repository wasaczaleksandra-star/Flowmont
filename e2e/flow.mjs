import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8081';
const OUT = new URL('./output/shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const admin = { email: `admin-${run}@example.test`, password: 'Haslo1234!' };
const store = { email: `sklep-${run}@example.test`, password: 'Haslo1234!' };
const results = [];
const log = (m) => {
  console.log(m);
  results.push(m);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
const btn = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).last();
const field = (label) => page.getByLabel(label, { exact: true }).filter({ visible: true }).last();
async function waitText(t, timeout = 15000) {
  await page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ timeout });
}

try {
  // 1. Admin registration + company
  await page.goto(`${BASE}/sign-up`);
  await field('Imię i nazwisko').fill('Adam Administrator');
  await field('E-mail').fill(admin.email);
  await field('Hasło').fill(admin.password);
  await btn('Załóż konto').click();
  await waitText('Załóż konto firmy montażowej');
  await shot('02-onboarding');
  await field('Nazwa firmy').fill('Okna Testowe Sp. z o.o.');
  await btn('Utwórz firmę i rozpocznij okres próbny').click();
  await waitText('Pulpit');
  await shot('03-dashboard');
  log('OK 1: admin registered, company created, dashboard shown');

  // 2. Store + invitation
  await page.goto(`${BASE}/stores`);
  await btn('Dodaj sklep').click();
  await field('Nazwa sklepu').fill('Salon Okien Centrum');
  await field('E-mail do powiadomień').fill(`salon-${run}@example.test`);
  await field('Miejscowość').fill('Warszawa');
  await btn('Zapisz').click();
  await waitText('Dodano sklep partnerski');
  await btn('Zaproś użytkownika').click();
  await field('E-mail osoby zapraszanej').fill(store.email);
  await btn('Wyślij zaproszenie').click();
  await waitText('Zaproszenie utworzone');
  const link = await field('Link zaproszenia').inputValue();
  await shot('04-invite');
  log(`OK 2: store created, invitation link ${link.replace(/[a-f0-9]{48}$/, '…')}`);
  await btn('Gotowe').click();

  // 3. Sign out, open invite link with a second account
  await page.goto(`${BASE}/account`);
  await btn('Wyloguj się').click();
  await waitText('Zaloguj się');
  await page.goto(link);
  await waitText('Zaproszenie do Flowmont');
  await shot('05-invite-signed-out');
  await btn('Załóż konto').click();
  await field('Imię i nazwisko').fill('Sylwia Sklep');
  await field('E-mail').fill(store.email);
  await field('Hasło').fill(store.password);
  await btn('Załóż konto').click();
  await waitText('Przyjmij zaproszenie');
  await btn('Przyjmij zaproszenie').click();
  await waitText('Kalendarz');
  await shot('06-store-calendar');
  log('OK 3: invited store user registered with separate account and accepted invitation');

  // 4. Store submits a request with measurements and a photo
  await page.goto(`${BASE}/jobs/new`);
  await waitText('Zgłoś montaż');
  await field('Imię i nazwisko klienta').fill('Jan Testowy');
  await field('Telefon klienta').fill('600 100 200');
  await field('Ulica i numer budynku/lokalu').fill('Fikcyjna 12/4');
  await field('Kod pocztowy').fill('00-950');
  await field('Miejscowość').fill('Warszawa');
  await page.getByRole('button', { name: /Proponowany termin montażu/ }).click();
  await page.getByRole('button', { name: 'Następny miesiąc' }).click();
  await page.getByRole('button', { name: /^środa, 18 listopada 2026$/ }).click();
  await page.getByRole('button', { name: /^piątek, 20 listopada 2026$/ }).click();
  await shot('07-range-picker');
  await btn('Wybierz').click();
  await field('Opis montażu').fill('Montaż 3 okien PCV z demontażem starych');
  await btn('Dodaj wymiar').click();
  await field('Nazwa (otwór/element)').fill('Okno kuchnia');
  await field('Szerokość').fill('1200');
  await field('Wysokość').fill('1500');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn('Dodaj dokument').click()]);
  await chooser.setFiles({ name: 'okno.png', mimeType: 'image/png', buffer: fs.readFileSync(new URL('../assets/images/icon.png', import.meta.url)) });
  await waitText('okno.png');
  await field('Dojazd, parking i wejście').fill('Brama od podwórza, kod 1234');
  await shot('08-request-form');
  await btn('Wyślij zgłoszenie').click();
  await waitText('Oczekuje na akceptację');
  await page.waitForTimeout(1500);
  await shot('09-store-job-detail');
  const jobUrl = page.url();
  const imgs = await page.locator('img[aria-label="okno.png"], img[alt="okno.png"]').count();
  log(`OK 4: request submitted (${jobUrl}); photo thumbnails visible: ${imgs}`);

  // 5. Admin approves
  await page.goto(`${BASE}/account`);
  await btn('Wyloguj się').click();
  await waitText('Zaloguj się');
  await field('E-mail').fill(admin.email);
  await field('Hasło').fill(admin.password);
  await btn('Zaloguj się').click();
  await waitText('Pulpit');
  await page.goto(`${BASE}/requests`);
  await waitText('Salon Okien Centrum');
  await shot('10-requests');
  await btn('Potwierdź').click();
  await waitText('Rezerwacja obejmie');
  await shot('11-confirm-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Potwierdź', exact: true }).click();
  await waitText('potwierdzone');
  log('OK 5: admin confirmed the request');

  // 6. Calendar shows the confirmed booking on every day
  await page.goto(`${BASE}/calendar`);
  await waitText('Kalendarz');
  await page.getByRole('button', { name: 'Następny okres' }).click();
  await page.waitForTimeout(1500);
  await shot('12-admin-calendar-month');
  const chips = await page.getByRole('link', { name: /Potwierdzone, Warszawa, dzień \d z 3/ }).count();
  log(`OK 6: calendar shows ${chips} day chips for the 3-day confirmed booking`);

  // 7. Notifications (mock adapter)
  await page.goto(`${BASE}/notifications`);
  await btn('Wyślij oczekujące teraz').click();
  await page.waitForTimeout(3500);
  await page.reload();
  await waitText('Powiadomienia');
  await page.waitForTimeout(1500);
  await shot('13-notifications');
  const mocked = await page.getByText('Tryb testowy – nie wysłano').count();
  log(`OK 7: notification log shows ${mocked} mock (not delivered) entries`);

  // 8. Job detail as admin with history
  await page.goto(jobUrl);
  await waitText('Historia');
  await page.waitForTimeout(1000);
  await shot('14-admin-job-detail');

  // 9. Mobile views
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/plan`);
  await waitText('Plan dnia');
  await page.getByRole('button', { name: 'Następny dzień' }).waitFor();
  await shot('15-mobile-plan');
  await page.goto(`${BASE}/calendar`);
  await waitText('Kalendarz');
  await page.getByRole('button', { name: 'Następny okres' }).click();
  await page.waitForTimeout(1500);
  await shot('16-mobile-calendar-agenda');
  await page.goto(jobUrl);
  await waitText('Historia');
  await page.waitForTimeout(800);
  await shot('17-mobile-job-detail');
  log('OK 9: mobile screenshots captured');
} catch (e) {
  log(`FAIL: ${e.message.split('\n')[0]} at ${page.url()}`);
  await shot('zz-failure');
} finally {
  log(`page errors: ${JSON.stringify(errors.slice(0, 8))}`);
  fs.writeFileSync(`${OUT}results.txt`, results.join('\n'));
  await browser.close();
}
