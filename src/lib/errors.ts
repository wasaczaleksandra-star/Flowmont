// Converts API errors into Polish messages for the user. Server functions already raise Polish
// messages (with a machine code in `hint`); everything else is mapped to a neutral message.

type AnyError = { message?: string; hint?: string | null; code?: string; status?: number } | null | undefined;

const AUTH_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Nieprawidłowy e-mail lub hasło.',
  'Email not confirmed': 'Potwierdź adres e-mail – link wysłaliśmy w wiadomości powitalnej.',
  'User already registered': 'Konto z tym adresem e-mail już istnieje. Zaloguj się.',
  'Password should be at least 6 characters': 'Hasło musi mieć co najmniej 6 znaków.',
  'New password should be different from the old password.': 'Nowe hasło musi różnić się od poprzedniego.',
  'Email rate limit exceeded': 'Wysłano zbyt wiele wiadomości. Spróbuj ponownie za kilka minut.',
  'For security purposes, you can only request this after': 'Ze względów bezpieczeństwa spróbuj ponownie za chwilę.',
  'Unable to validate email address: invalid format': 'Podaj poprawny adres e-mail.',
  'Signups not allowed for this instance': 'Rejestracja jest obecnie wyłączona.',
};

export function errorCode(e: AnyError): string | null {
  return e?.hint ?? null;
}

export function toUserMessage(e: unknown, fallback = 'Coś poszło nie tak. Spróbuj ponownie.'): string {
  const err = e as AnyError;
  if (!err) return fallback;
  if (err.hint && err.message) return err.message; // our own Polish messages
  const msg = err.message ?? '';
  for (const [k, v] of Object.entries(AUTH_MESSAGES)) {
    if (msg.startsWith(k)) return v;
  }
  if (err.code === '42501') return 'Nie masz uprawnień do wykonania tej operacji.';
  if (err.code === '23505') return 'Taki rekord już istnieje.';
  if (err.code === '23P01') return 'Ekipa ma już zlecenie w tym terminie.';
  if (/Failed to fetch|Network request failed|NetworkError/i.test(msg)) {
    return 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.';
  }
  if (/new row violates row-level security/i.test(msg)) return 'Nie masz uprawnień do wykonania tej operacji.';
  if (/JWT expired|invalid JWT/i.test(msg)) return 'Sesja wygasła. Zaloguj się ponownie.';
  return fallback;
}
