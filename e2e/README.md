# Testy end-to-end (przeglądarka)

Scenariusze klikają aplikację tak jak użytkownik (Playwright) i zapisują zrzuty ekranu do `e2e/output/`.

- `flow.mjs` – rejestracja firmy → sklep → zaproszenie → drugie konto sklepu → zgłoszenie z wymiarami i zdjęciem → akceptacja → kalendarz (3 dni) → dziennik powiadomień → widoki mobilne.
- `flow2.mjs` – zlecenia administratora z potwierdzeniem, blokada kolizji ekipy, anulowanie → zwolniony termin → ogłoszenie (wysłane raz), import CSV z błędami i duplikatem, ekipa na telefonie (rozpocznij/zakończ), wygaśnięcie okresu próbnego → tryb tylko do odczytu.

Uruchomienie (wymaga działającej aplikacji web i backendu z migracjami):

```bash
npm run web                                   # aplikacja na http://localhost:8081
CHROMIUM_PATH=/ścieżka/do/chromium node e2e/flow.mjs
E2E_DATABASE_URL=postgresql://… node e2e/flow2.mjs   # flow2 ustawia kilka stanów bezpośrednio w bazie testowej
```

Backend: najprościej `npx supabase start` (Docker) z włączonym `enable_confirmations = false` na czas testów.
Bez Dockera: `e2e/local-stack/start.sh` uruchamia GoTrue + PostgREST + bramkę z emulacją Storage na lokalnym PostgreSQL (tylko do testów).
**Nigdy nie uruchamiaj tych scenariuszy na produkcji** – zakładają konta i firmy testowe.
