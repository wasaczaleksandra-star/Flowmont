# Flowmont

Flowmont to aplikacja SaaS dla firm montażowych (np. montaż okien), które przyjmują zlecenia od sklepów partnerskich.
Sklep zgłasza termin i dane montażu → firma montażowa akceptuje lub odrzuca → przydziela ekipę → ekipa realizuje montaż w terenie.

- **Aplikacja:** Expo SDK 58 (React Native + Expo Router) – jedna baza kodu dla **przeglądarki (panel administratora), iOS i Androida**.
- **Backend:** Supabase – PostgreSQL z politykami RLS, logowanie (e-mail, link, Google), prywatne pliki, Edge Functions.
- **Powiadomienia:** kolejka (outbox) w bazie + wymienne adaptery: Resend (e-mail), SMSAPI.pl lub Twilio (SMS), tryb testowy.
- **Płatności:** Stripe (tryb testowy) przez Edge Functions; plany i ceny konfigurowalne, bez zaszytych kwot.

Całe UI, komunikaty i e-maile są po polsku, daty w strefie Europe/Warsaw.

## Szybki start (lokalnie)

Wymagania: Node 20+, [Supabase CLI](https://supabase.com/docs/guides/local-development) i Docker.

```bash
npm install
npx supabase start            # lokalna baza + auth + storage (migracje z supabase/migrations)
cp .env.example .env.local    # wpisz URL i klucz z `npx supabase status`
npm run web                   # http://localhost:8081
```

Telefon: `npm start` i zeskanuj kod QR (Expo Go) albo zbuduj development build (`npx eas-cli build --profile development`).

Dane demo (fikcyjne firmy, sklepy, ekipy i zlecenia we wszystkich statusach):

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service_role z supabase status> npm run seed:demo -- --reset
```

## Polecenia

| Polecenie | Co robi |
| --- | --- |
| `npm run web` / `npm start` | serwer deweloperski (web / telefon) |
| `npm run typecheck` | TypeScript (aplikacja + współdzielony kod Edge Functions) |
| `npm run lint` | ESLint (konfiguracja Expo + reguły React Compiler) |
| `npm test` | testy jednostkowe (daty, statusy, import, adaptery, Stripe) |
| `npm run test:db` | testy bazy na PostgreSQL: izolacja firm i sklepów, uprawnienia, statusy, kolizje, trial, powiadomienia, import |
| `npm run build:web` | produkcyjny build web do `dist/` |
| `npm run seed:demo` | dane demonstracyjne |

`test:db` potrzebuje dostępu do serwera PostgreSQL (zmienne `PGHOST`, `PGPORT`, `PGUSER`; domyślny adres testów: `TEST_DATABASE_URL`).

## Struktura

```
src/app/            ekrany (Expo Router) – (app)/ = część po zalogowaniu
src/features/       logika ekranów: sesja i role, kalendarz, zlecenia, import, administracja
src/components/ui/  komponenty interfejsu (dostępne, z dużymi polami dotyku)
src/lib/            daty (Europe/Warsaw), statusy, klient Supabase, błędy
supabase/migrations schemat, RLS, reguły rezerwacji, powiadomienia, import, billing
supabase/functions  Edge Functions: process-outbox, billing-checkout, billing-portal, billing-webhook
supabase/tests      testy integracyjne bazy
scripts/            reset bazy testowej, seed demo
docs/               konfiguracja, architektura, instrukcja, wyniki testów
```

## Dokumentacja

- [docs/KONFIGURACJA.md](docs/KONFIGURACJA.md) – Supabase, domeny i logowanie (w tym Google), e-mail, SMS, Stripe, harmonogram, wdrożenie web i mobile
- [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) – model danych, izolacja firm, reguły rezerwacji, statusy, dostęp po okresie próbnym, decyzje i założenia
- [docs/INSTRUKCJA.md](docs/INSTRUKCJA.md) – krótka instrukcja dla administratora, sklepu i ekipy
- [docs/TESTY.md](docs/TESTY.md) – co zostało sprawdzone, wyniki i czego nie dało się zweryfikować
