import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, TextField } from '@/components/ui';
import { AuthLayout, signInWithGoogle } from '@/features/auth';
import { env } from '@/lib/env';
import { toUserMessage } from '@/lib/errors';
import { setPendingNext } from '@/lib/pending';
import { authRedirectUrl, safeNextPath } from '@/lib/redirect';
import { supabase } from '@/lib/supabase';

export default function SignUp() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = params.next ? safeNextPath(params.next) : null;
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const e: Record<string, string> = {};
    if (fullName.trim().length < 2) e.fullName = 'Podaj imię i nazwisko.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = 'Podaj poprawny adres e-mail.';
    if (password.length < 8) e.password = 'Hasło musi mieć co najmniej 8 znaków.';
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    if (next) setPendingNext(next);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: authRedirectUrl(`/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`),
      },
    });
    setBusy(false);
    if (error) return setError(toUserMessage(error));
    // With e-mail confirmation enabled the session arrives after the link is clicked.
    if (!data.session) setDone(true);
  }

  if (done) {
    return (
      <AuthLayout title="Sprawdź skrzynkę e-mail">
        <Banner tone="success" title="Konto zostało utworzone">
          {`Wysłaliśmy link potwierdzający na adres ${email.trim()}. Kliknij go, aby dokończyć rejestrację.`}
        </Banner>
        <AppText variant="muted">Nie widzisz wiadomości? Sprawdź folder SPAM lub spróbuj zarejestrować się ponownie za kilka minut.</AppText>
        <Link href="/sign-in" asChild>
          <Button title="Przejdź do logowania" variant="secondary" />
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Załóż konto"
      subtitle={next?.startsWith('/invite/') ? 'Użyj adresu e-mail, na który przyszło zaproszenie.' : 'Firma montażowa otrzymuje 3 dni okresu próbnego.'}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField label="Imię i nazwisko" value={fullName} onChangeText={setFullName} error={errors.fullName} autoComplete="name" required />
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        required
      />
      <TextField
        label="Hasło"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="new-password"
        hint="Minimum 8 znaków."
        required
      />
      <Button title="Załóż konto" onPress={submit} loading={busy} />
      {env.googleAuthEnabled ? (
        <Button
          title="Kontynuuj z Google"
          variant="secondary"
          icon="logo-google"
          onPress={() => {
            if (next) setPendingNext(next);
            signInWithGoogle(next ?? undefined).catch((e) => setError(toUserMessage(e)));
          }}
        />
      ) : null}
      <AppText variant="muted" style={{ textAlign: 'center' }}>
        Masz już konto?{' '}
        <Link href={{ pathname: '/sign-in', params: next ? { next } : {} }} style={{ textDecorationLine: 'underline', fontWeight: '600' }}>
          Zaloguj się
        </Link>
      </AppText>
    </AuthLayout>
  );
}
