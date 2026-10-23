# Konfiguracja i wdrożenie

Kolejność: **1. Supabase → 2. Domena i logowanie → 3. E-mail/SMS → 4. Harmonogram → 5. Stripe → 6. Web → 7. Mobile.**
Każdy krok poza pierwszym jest opcjonalny – bez niego aplikacja działa, a brakująca funkcja jest uczciwie oznaczona jako nieskonfigurowana.

Zasada bezpieczeństwa: do aplikacji (`EXPO_PUBLIC_*`) trafiają tylko **publiczne** wartości (URL i klucz publiczny Supabase).
Klucze tajne (service role, Stripe, Resend, SMS) ustawiasz wyłącznie jako sekrety Edge Functions.

---

## 1. Projekt Supabase

1. Utwórz projekt na [supabase.com](https://supabase.com/dashboard) (region UE, np. Frankfurt – dane klientów w UE).
2. Zastosuj migracje:
   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF>
   npx supabase db push
   ```
3. **Project Settings → API**: skopiuj *Project URL* i *Publishable key (anon)* do `.env.local` / zmiennych hostingu:
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Adres aplikacji używany w linkach e-mail (zaproszenia, zlecenia) – SQL Editor:
   ```sql
   insert into public.app_settings (key, value) values ('app_url', 'https://app.twojadomena.pl')
   on conflict (key) do update set value = excluded.value;
   ```
5. Właściciel platformy (Ty): po założeniu własnego konta w aplikacji wykonaj w SQL Editor:
   ```sql
   update public.profiles set is_platform_owner = true where email = 'twoj@email.pl';
   ```
   Panel „Platforma” pokazuje tylko dane operacyjne kont (bez szczegółów zleceń i plików).

## 2. Domena, przekierowania logowania i Google

**Authentication → URL Configuration**

- *Site URL*: adres produkcyjny, np. `https://app.twojadomena.pl`.
- *Redirect URLs* – dodaj **każdą** domenę, z której ktoś się loguje:
  ```
  https://app.twojadomena.pl/**
  https://*-twoj-projekt.vercel.app/**        (podglądy/preview – osobno od produkcji)
  http://localhost:8081/**                    (praca lokalna)
  flowmont://**                               (aplikacja mobilna)
  exp://**                                    (Expo Go w trakcie testów)
  ```
- Aplikacja webowa zawsze wysyła link powrotny na **bieżącą domenę** (`window.location.origin`), więc zmiana domeny nie wymaga zmian w kodzie – wystarczy dopisać nową domenę do listy powyżej. Jeśli domena nie jest na liście, Supabase przekieruje na *Site URL*.

**Szablony e-mail (zalecane)** – *Authentication → Email Templates*. Domyślne linki działają tylko w tej samej przeglądarce (PKCE).
Aby link z e-maila działał na dowolnym urządzeniu, ustaw:

- *Confirm signup*: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
- *Magic Link*: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
- *Reset Password*: `{{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}&type=recovery`

Ekran `/auth/callback` obsługuje oba warianty (`code` i `token_hash`) i pokazuje czytelny komunikat, gdy link wygasł.
Uwaga: `{{ .SiteURL }}` zawsze prowadzi na domenę produkcyjną – do testów na domenie preview używaj osobnego projektu Supabase z jej adresem jako *Site URL*.
Jeśli ktoś po potwierdzeniu konta otworzy aplikację na innym urządzeniu niż to, na którym kliknął zaproszenie, zobaczy baner „Masz oczekujące zaproszenie” i ponownie otworzy link z e-maila (nie założy przypadkiem drugiej firmy).
Wysyłkę e-maili logowania przez własną domenę ustawisz w *Authentication → SMTP Settings* (np. dane SMTP z Resend).

**Google**

1. [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services → Credentials → Create OAuth client ID* → typ *Web application*.
2. *Authorized redirect URI*: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.
3. Supabase → *Authentication → Providers → Google*: wklej Client ID i Secret, włącz.
4. Dopiero teraz ustaw `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED=true` – przycisk „Zaloguj się przez Google” pojawi się w aplikacji. Bez tego przycisk jest ukryty.

## 3. Powiadomienia e-mail i SMS

Bez konfiguracji działa **tryb testowy**: wiadomości są zapisywane z podglądem i statusem „Tryb testowy – nie wysłano”. Nigdy nie są oznaczane jako dostarczone.
Firmy demo (`is_demo = true`) nigdy nie wysyłają prawdziwych wiadomości.

Wdróż funkcję i ustaw sekrety:

```bash
npx supabase functions deploy process-outbox
npx supabase secrets set EMAIL_PROVIDER=resend RESEND_API_KEY=re_xxx EMAIL_FROM="Flowmont <powiadomienia@twojadomena.pl>"
# SMS – wybierz jednego dostawcę:
npx supabase secrets set SMS_PROVIDER=smsapi SMSAPI_TOKEN=xxx SMS_SENDER_NAME=Flowmont
# lub
npx supabase secrets set SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=xxx TWILIO_FROM=+48xxxxxxxxx
```

- **Resend**: zweryfikuj domenę nadawcy (rekordy DNS SPF/DKIM) – inaczej e-maile trafią do SPAM-u.
- **SMSAPI.pl**: pole nadawcy (`SMS_SENDER_NAME`) musi być zatwierdzone w panelu SMSAPI.
- Statusy i błędy wysyłki widać w **Powiadomienia**; nieudaną wiadomość można ponowić przyciskiem „Ponów wysyłkę”.
- Wiadomości zawierają minimum danych osobowych (numer zlecenia, termin, miejscowość, sklep) – bez nazwiska i telefonu klienta. Klienci końcowi nie dostają powiadomień.

## 4. Harmonogram (zalecane)

Aplikacja prosi o wysyłkę zaraz po każdej akcji, ale stały harmonogram gwarantuje doręczenie także po błędach.
Uruchom SQL z pliku [`supabase/cron.example.sql`](../supabase/cron.example.sql) (wymaga rozszerzeń `pg_cron` i `pg_net` – *Database → Extensions*).

## 5. Subskrypcje (Stripe, tryb testowy)

Ceny nie są zaszyte w kodzie. Dopóki nie skonfigurujesz planów, ekran „Subskrypcja” pokazuje informację „Płatności online nie są jeszcze skonfigurowane”.

1. Stripe (tryb **Test**) → *Product catalog* → utwórz produkt i cenę cykliczną → skopiuj `price_…`.
2. Dodaj plan (SQL Editor):
   ```sql
   insert into public.billing_plans (id, name, price_label, provider_price_id, sort)
   values ('standard', 'Standard', 'np. 199 zł netto / mies.', 'price_xxx', 1);
   ```
   (`price_label` to tekst wyświetlany klientowi – wpisz faktyczną cenę z Stripe.)
3. Funkcje i sekrety:
   ```bash
   npx supabase functions deploy billing-checkout
   npx supabase functions deploy billing-portal
   npx supabase functions deploy billing-webhook --no-verify-jwt
   npx supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx APP_URL=https://app.twojadomena.pl
   ```
4. Stripe → *Developers → Webhooks* → endpoint `https://<PROJECT_REF>.supabase.co/functions/v1/billing-webhook`,
   zdarzenia: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Skopiuj *Signing secret*: `npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx`.
5. Włącz panel klienta Stripe (*Settings → Billing → Customer portal*).
6. Ustaw `EXPO_PUBLIC_BILLING_ENABLED=true` i przebuduj aplikację.

Klucz `sk_live_…` jest odrzucany, dopóki nie ustawisz świadomie `STRIPE_ALLOW_LIVE=true`. Opis stanów dostępu: [ARCHITEKTURA.md](ARCHITEKTURA.md#okres-próbny-i-subskrypcja).

## 6. Wdrożenie wersji web

Aplikacja web jest statyczną aplikacją SPA (`web.output: "single"`) – hostujesz katalog `dist/`.

**Vercel** (plik `vercel.json` jest gotowy):
1. *Add New → Project* → wybierz repozytorium.
2. *Environment Variables*: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, opcjonalnie `EXPO_PUBLIC_GOOGLE_AUTH_ENABLED`, `EXPO_PUBLIC_BILLING_ENABLED`.
   Dla środowiska *Preview* możesz wskazać osobny projekt Supabase (zalecane – testy nie dotykają danych produkcyjnych).
3. Deploy. Następnie dodaj domenę produkcyjną i domeny preview do *Redirect URLs* w Supabase (krok 2).

Netlify/inny hosting: `npm run build:web`, publikuj `dist/` (plik `public/_redirects` przekierowuje wszystkie ścieżki na `index.html`).

## 7. Aplikacje mobilne (iOS / Android)

```bash
npx eas-cli login
npx eas-cli init                          # połączy projekt z kontem Expo
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_URL --value ... --environment production
npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value ... --environment production
npx eas-cli build --profile preview --platform android   # instalacja testowa (APK)
npx eas-cli build --profile production --platform all    # sklepy
```

Identyfikatory aplikacji: `app.flowmont` (zmień w `app.json` przed pierwszą publikacją, jeśli chcesz inny).
Logowanie Google w aplikacji mobilnej korzysta z przekierowania `flowmont://auth/callback` – dodaj je do *Redirect URLs*.
