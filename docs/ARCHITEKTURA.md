# Architektura i reguły biznesowe

## Przegląd

```
Expo (web / iOS / Android)
  │  supabase-js (klucz publiczny + sesja użytkownika)
  ▼
Supabase
  ├─ Auth (e-mail+hasło, link, Google, PKCE)
  ├─ PostgREST → tabele z RLS + funkcje RPC (SECURITY DEFINER) z regułami biznesowymi
  ├─ Storage: prywatny bucket job-files, polityki = te same reguły widoczności co zlecenia
  └─ Edge Functions (service role, tylko serwer):
       process-outbox   – wysyłka kolejki powiadomień przez adaptery
       billing-*        – Stripe Checkout, portal klienta, webhook
```

Dlaczego bez własnego serwera API: wszystkie reguły (uprawnienia, statusy, kolizje terminów, okres próbny) są egzekwowane **w bazie** – przez RLS, ograniczenia i funkcje RPC. Klient (web lub telefon) nie może ich obejść, nawet wysyłając zapytania bezpośrednio do API.

## Model danych (najważniejsze tabele)

| Obszar | Tabele |
| --- | --- |
| Firmy (tenanci) | `companies`, `company_members` (rola: admin / store_user / crew_member), `subscriptions`, `billing_plans`, `billing_events` |
| Użytkownicy | `profiles` (1:1 z `auth.users`), `invitations` (tylko hash tokenu) |
| Sklepy i ekipy | `stores`, `store_members`, `crews`, `crew_members` |
| Zlecenia | `jobs`, `job_measurements`, `job_attachments`, `job_notes` (wspólne / wewnętrzne), `job_activity` (historia), `plan_positions` |
| Dostępność | `availability_blocks` (cała firma lub jedna ekipa) |
| Powiadomienia | `notification_preferences`, `notification_outbox`, `announcements`, `announcement_recipients`, `app_settings` |
| Import | `import_runs`, `import_row_errors` |
| Audyt | `audit_events` |

Każda tabela firmowa ma `company_id` i klucze obce złożone `(id, company_id)` – sklep, ekipa i zlecenie nie mogą „przeskoczyć” do innej firmy nawet na poziomie danych.

## Izolacja firm i sklepów

- Dostęp wynika wyłącznie z `auth.uid()` i członkostwa (`company_members`, `store_members`, `crew_members`). `company_id` wysłany przez klienta nie jest dowodem uprawnień – każda funkcja sprawdza członkostwo.
- **Administrator** widzi wszystkie dane swojej firmy. **Sklep** widzi tylko swoje zlecenia; zajętość innych sklepów zna wyłącznie z funkcji `get_availability` (liczba wolnych ekip na dzień, bez nazw i adresów). **Ekipa** widzi zlecenia przypisane do swojej ekipy.
- Notatki wewnętrzne i wewnętrzna historia są w osobnych wierszach z flagą `is_internal` – RLS ukrywa je przed sklepem i ekipą.
- Pliki: ścieżka `{company_id}/{job_id}/…`; podpisane linki (10 min) wydaje Storage tylko użytkownikowi, który widzi zlecenie.
- Właściciel platformy nie ma dostępu do tabel klientów – tylko do funkcji `platform_*` z danymi operacyjnymi.

## Daty i strefa czasowa

- Montaże całodniowe zapisujemy jako dwie kolumny `DATE` z **włącznym** końcem: `start = pierwszy dzień`, `end = ostatni dzień` (montaż 18–20 listopada ma `end = 2026-11-20`).
- Kolumny pomocnicze `daterange(start, end, '[]')` (Postgres zapisuje je jako `[start, end+1)`) służą do sprawdzania nakładania się.
- Dni nie przechodzą przez obiekty `Date` w lokalnej strefie, więc zmiana czasu (marzec/październik) nie przesuwa terminów. „Dziś” liczone jest w Europe/Warsaw (w bazie i w aplikacji). Znaczniki czasu (`timestamptz`) są w UTC, wyświetlane w Europe/Warsaw.

## Rezerwacje i pojemność

- Zgłoszenie sklepu ma status **Oczekuje na akceptację** i **nie rezerwuje** ekipy. Wiele zgłoszeń może się nakładać – administrator widzi ostrzeżenie.
- Potwierdzenie (`confirm_job`) w jednej transakcji: blokuje wiersz ekipy, sprawdza blokady dostępności i kolizje, przypisuje ekipę i daty.
- **Gwarancja w bazie:** ograniczenie wykluczające `jobs_crew_no_overlap` (`EXCLUDE USING gist (crew_id WITH =, confirmed_span WITH &&) WHERE status IN ('confirmed','in_progress')`). Dwa równoległe potwierdzenia tej samej ekipy na ten sam dzień nie mogą się udać – drugie dostaje komunikat „Ekipa ma już zlecenie w tym terminie”.
- Montaż wielodniowy rezerwuje ekipę na każdy dzień zakresu. Różne ekipy mogą mieć zlecenia tego samego dnia.
- Zmiana terminu (`reschedule_job`) przechodzi te same kontrole. Odrzucone i anulowane zlecenia nie zajmują ekipy. Zakończone zostają w historii kalendarza.
- Blokada dostępności nie może przykryć potwierdzonego zlecenia (najpierw trzeba je przenieść lub anulować).
- Firma zawsze ma ekipę domyślną (tworzoną przy rejestracji); kolejne ekipy są opcjonalne.

## Statusy

| Z | Na | Kto |
| --- | --- | --- |
| Oczekuje na akceptację | Potwierdzone / Odrzucone | administrator |
| Oczekuje na akceptację | Anulowane | administrator lub sklep („Wycofaj zgłoszenie”) |
| Potwierdzone | W realizacji | przypisana ekipa lub administrator |
| Potwierdzone | Anulowane | administrator |
| W realizacji | Zakończone | przypisana ekipa lub administrator |

Przejścia wymusza trigger w bazie (`app.enforce_job_transition`) – nie ma „dowolnej listy statusów”. Każda zmiana trafia do historii z autorem i czasem.
Sklep edytuje zgłoszenie tylko, dopóki oczekuje; zmiana potwierdzonego terminu to akcja administratora.

## Powiadomienia

- Zdarzenia (nowe zgłoszenie, potwierdzenie, odrzucenie, zmiana terminu, anulowanie, wycofanie, zakończenie, zwolniony termin, ogłoszenie, zaproszenie) są zapisywane do `notification_outbox` w tej samej transakcji co zmiana – nic nie ginie przy błędzie sieci.
- **Idempotencja:** unikalny `idempotency_key` (zdarzenie + zlecenie + wpis historii + kanał + odbiorca), atomowe pobieranie `FOR UPDATE SKIP LOCKED`, nagłówek `Idempotency-Key` u dostawcy e-mail. Wynik nigdy nie nadpisuje stanu końcowego.
- Ponowienia: do 5 prób z rosnącym odstępem (2, 4, 8, 16 min), potem „Błąd wysyłki” widoczny dla administratora z przyciskiem „Ponów wysyłkę”.
- Statusy: W kolejce, Wysyłanie, Wysłano, Błąd wysyłki, **Tryb testowy – nie wysłano** (adapter testowy lub firma demo).
- Po anulowaniu/przeniesieniu potwierdzonego zlecenia administrator dostaje informację o zwolnionym terminie i propozycję ogłoszenia – **bez** automatycznej wysyłki do wszystkich sklepów.
- Ogłoszenie można wysłać tylko raz (`send_announcement` sprawdza `sent_at` pod blokadą).

## Okres próbny i subskrypcja

Okres próbny: 3 dni od utworzenia firmy (`trial_ends_at`). Dostęp liczony na serwerze funkcją `app.access_level`:

| Stan | Dostęp |
| --- | --- |
| okres próbny trwa | pełny |
| subskrypcja aktywna (`active`) | pełny |
| zaległa płatność (`past_due`) | pełny (okres karencji, Stripe ponawia płatność) |
| próba wygasła bez subskrypcji / `expired` | tylko odczyt |
| subskrypcja anulowana (`cancelled`, także `unpaid`) | tylko odczyt |
| zawieszona przez właściciela platformy | administrator: odczyt i ekran subskrypcji; pozostali: brak dostępu |

„Tylko odczyt” = dane widoczne, logowanie i ekran Subskrypcja działają, ale każda zmiana (zgłoszenia, potwierdzenia, sklepy, pliki, import, zaproszenia) jest odrzucana przez bazę z komunikatem po polsku.

## Import

Plik (.xlsx / .csv; polski Excel – średniki) jest parsowany w przeglądarce, kolumny dopasowywane automatycznie (z możliwością zmiany).
Serwer (`import_preview`) jest jedynym źródłem prawdy: waliduje każdy wiersz, wykrywa duplikaty (w pliku i w bazie), zapisuje podgląd i błędy. `import_commit` waliduje ponownie i zapisuje tylko poprawne wiersze **do firmy wywołującego** – kolumny typu `company_id` są ignorowane. Import nie wysyła wiadomości, chyba że administrator zaznaczy tę opcję.

## Decyzje i założenia

- **Expo zamiast Next.js** – na Twoją prośbę: jedna aplikacja dla panelu w przeglądarce i dla ekip na telefonach. Web eksportowany jako SPA.
- **Style:** `StyleSheet` + tokeny palety „Electric Sunset” (`src/theme/tokens.ts`) zamiast Tailwind/NativeWind – mniej zależności i stabilny build na trzech platformach. Kolory statusów: oczekujące – bursztyn z przerywaną ramką, potwierdzone – niebieski, w realizacji – pomarańcz, zakończone – szaroniebieski; odrzucone dostały stonowaną czerwień, bo paleta nie ma koloru „błąd”.
- Sklep należy do jednej firmy montażowej; jeden użytkownik może należeć do kilku firm (przełącznik firm w menu).
- Sklep nie może wybrać dni pełnych/zablokowanych ani z przeszłości; administrator może (np. aby wpisać historyczne zlecenie), ale kolizje i tak blokuje baza.
- Numer zlecenia: `FM-RRRR-NNNN`, osobna numeracja dla każdej firmy i roku.
- Pliki: zdjęcia JPG/PNG/WEBP/HEIC, PDF, Excel, Word, CSV; maks. 20 MB. HEIC nie ma podglądu w przeglądarce – pokazujemy ikonę i pobieranie.
- Szablony importu są w CSV (otwierają się w Excelu); import przyjmuje .xlsx i .csv.
- Kolejność „Planu dnia” ustawia administrator strzałkami; bez optymalizacji tras.
