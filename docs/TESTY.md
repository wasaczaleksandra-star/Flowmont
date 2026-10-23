# Testy i weryfikacja

Stan na 23.10.2026. Wszystkie wyniki poniżej pochodzą z faktycznych uruchomień w tym repozytorium.

## Wyniki automatyczne

| Sprawdzenie | Polecenie | Wynik |
| --- | --- | --- |
| Lint (Expo ESLint + React Compiler) | `npm run lint` | 0 błędów, 0 ostrzeżeń |
| TypeScript (aplikacja + kod współdzielony funkcji) | `npm run typecheck` | OK |
| Testy jednostkowe | `npm test` | 26/26 ✔ |
| Testy bazy (PostgreSQL 16, wszystkie migracje) | `npm run test:db` | 49/49 ✔ |
| Build web (produkcyjny) | `npm run build:web` | OK, 2,5 MB |
| Bundle iOS i Android (Hermes) | `npx expo export -p ios -p android` | OK |

Każdy test bazy sprawdzono też „odwrotnie”: po usunięciu ograniczenia `jobs_crew_no_overlap` test podwójnej rezerwacji zaczyna padać.

### Co obejmują testy bazy (`supabase/tests`)

- **Izolacja firm:** firma B nie czyta rekordów firmy A (zlecenia, sklepy, wymiary, historia, zaproszenia, powiadomienia), nie wywoła na nich akcji RPC, nie utworzy zlecenia dla obcego sklepu, nie zobaczy dostępności ani plików; nie wgra pliku do folderu innej firmy.
- **Izolacja sklepów:** sklep widzi tylko swój sklep i swoje zlecenia; nie czyta cudzych wymiarów/historii, nie edytuje cudzego zgłoszenia, nie zgłasza w imieniu innego sklepu; dostępność widzi bez szczegółów; nie widzi notatek wewnętrznych, zaproszeń, kolejki powiadomień ani innych użytkowników; po dezaktywacji traci dostęp, a historia zostaje.
- **Role:** ekipa widzi tylko zlecenia swojej ekipy i nie zarządza danymi; tylko administrator potwierdza/odrzuca/anuluje; anonimowy użytkownik nie czyta nic.
- **Statusy:** pełna ścieżka oczekuje → potwierdzone → w realizacji → zakończone z historią; zabronione przejścia odrzucane; bezpośredni UPDATE statusu z klienta niemożliwy.
- **Terminy i pojemność:** montaż wielodniowy zajmuje każdy dzień; kolizja tej samej ekipy odrzucona; inna ekipa w tym samym dniu – OK; oczekujące zgłoszenia nie rezerwują; **równoległe potwierdzenia (dwie transakcje)** – udaje się tylko jedno; ograniczenie bazy działa nawet z pominięciem RPC; blokady dostępności; zmiana terminu z kontrolą kolizji, zachowaniem załączników i wpisem w historii; anulowanie zwalnia termin.
- **Okres próbny:** 3 dni od rejestracji; po wygaśnięciu dane czytelne, każda zmiana odrzucona; aktywna subskrypcja przywraca dostęp; zdarzenia płatności idempotentne; `past_due` zachowuje dostęp; zawieszenie przez właściciela platformy.
- **Zaproszenia:** tylko adresat (ten sam e-mail) może przyjąć, jednorazowo; wygasłe – czytelny komunikat; przechowywany tylko hash.
- **Powiadomienia:** brak duplikatów dla tego samego zdarzenia; dwa procesy nie pobiorą tej samej wiadomości; ponowienia → błąd → ręczne ponowienie; tryb testowy nigdy nie jest „wysłano”; ogłoszenie tylko do wybranych sklepów i tylko raz; firmy demo nie wysyłają nic.
- **Import:** walidacja wierszy, duplikaty w pliku i w bazie, nic nie zapisuje się przed potwierdzeniem, zapis tylko do firmy importującego (kolumna `company_id` z pliku ignorowana), brak wiadomości bez zgody, obca firma nie widzi ani nie zatwierdzi importu.

### Testy jednostkowe

Daty (zmiana czasu marzec/październik, „dziś” w Warszawie o północy UTC, polskie formaty zakresów, daty z Excela), reguły statusów i akcji dla ról, bezpieczne przekierowania, parser CSV (średniki, BOM, cudzysłowy), mapowanie kolumn, adaptery (tryb testowy, klucz idempotencji e-mail, numery telefonów), weryfikacja podpisu Stripe i mapowanie statusów.

## Testy end-to-end w przeglądarce (`e2e/`)

Uruchomione na lokalnym stosie: PostgreSQL 16 + Supabase Auth (GoTrue v2.177) + PostgREST v12 + bramka z emulacją Storage (z prawdziwymi politykami RLS) + prawdziwy procesor kolejki z adapterem testowym. Wynik: **wszystkie kroki OK, 0 błędów JavaScript na stronie**.

| # | Kryterium | Wynik |
| --- | --- | --- |
| 1 | Administrator tworzy sklep i zaprasza użytkownika | ✔ (`flow.mjs` krok 2) |
| 2 | Zaproszony loguje się osobnym kontem i widzi tylko swój sklep | ✔ (krok 3, testy bazy) |
| 3 | Zgłoszenie jednodniowe/wielodniowe z danymi, wymiarami i zdjęciem | ✔ (krok 4; miniatura i podgląd zdjęcia widoczne) |
| 4 | Administrator potwierdza i przypisuje ekipę | ✔ (krok 5) |
| 5 | Kalendarz pokazuje potwierdzoną rezerwację | ✔ (krok 6) |
| 6 | Sklep otrzymuje powiadomienie lub oznaczony podgląd testowy | ✔ (krok 7: „Tryb testowy – nie wysłano”) |
| 7 | Rezerwacja wielodniowa zajmuje każdy dzień | ✔ (3 dni w kalendarzu + test bazy) |
| 8 | Kolizje tej samej ekipy odrzucone, także równoległe | ✔ (`flow2` B + test bazy z dwiema transakcjami) |
| 9 | Różne ekipy tego samego dnia | ✔ (test bazy) |
| 10 | Sklep nie dostanie cudzych danych/plików, także przez API | ✔ (testy bazy + bezpośredni URL: „Nie znaleziono zlecenia”) |
| 11 | Firma nie dostanie danych/plików innej firmy | ✔ (testy bazy + bezpośredni URL) |
| 12 | Zmiana terminu waliduje pojemność i trafia do historii | ✔ (test bazy) |
| 13 | Anulowanie zwalnia termin i proponuje ogłoszenie | ✔ (`flow2` D, D2) |
| 14 | Ogłoszenia tylko do wybranych, bez duplikatów | ✔ (`flow2` D + test bazy) |
| 15 | Ekipa na telefonie rozpoczyna i kończy montaż | ✔ (`flow2` F, 390×844) |
| 16 | Import waliduje, pokazuje podgląd, respektuje izolację | ✔ (`flow2` E + test bazy) |
| 17 | Wygasły trial blokuje zmiany na serwerze, dane i subskrypcja dostępne | ✔ (`flow2` G + test bazy) |
| 18 | Google: działa po konfiguracji; brak konfiguracji obsłużony uczciwie | częściowo – przycisk ukryty bez konfiguracji ✔; samo logowanie Google **nie było testowane** (brak kluczy) |
| 19 | Przekierowania logowania z domeną wdrożenia | częściowo – adres powrotu = bieżąca domena, odświeżenie podstron i powrót do zaproszenia po rejestracji ✔; na prawdziwej domenie **nie testowane** |
| 20 | Błędy dostawców widoczne i do ponowienia | ✔ (test bazy: ponowienia, status błędu, ręczne ponowienie; ekran Powiadomienia) |

Zrzuty ekranu desktop i mobile (390 px) zostały obejrzane: poprawiono przy tym m.in. menu boczne, karty wychodzące poza ekran telefonu, zawijanie tytułu kalendarza i ukrywanie filtrów na telefonie.

## Czego NIE zweryfikowano (wymaga Twoich kont/kluczy)

- Prawdziwa wysyłka e-mail (Resend) i SMS (SMSAPI/Twilio) – kod adapterów testowany jednostkowo, bez połączenia z dostawcą.
- Logowanie Google, linki e-mail z prawdziwej skrzynki (w testach potwierdzanie e-mail było wyłączone).
- Stripe Checkout/portal/webhook z prawdziwym kontem testowym Stripe (logika podpisu i mapowania – testy jednostkowe; zapis zdarzeń – testy bazy).
- Hostowany Supabase: Storage był emulowany (te same polityki RLS), Edge Functions uruchamiane były przez lokalną bramkę, a nie przez runtime Deno.
- Uruchomienie natywne na fizycznym iPhonie/Androidzie (sprawdzono kompilację bundli, nie działanie na urządzeniu): aparat, galeria, linki `flowmont://`.
- Harmonogram `pg_cron` (plik przykładowy, nieuruchomiony).
