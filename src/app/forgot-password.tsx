import { Link } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, TextField } from '@/components/ui';
import { AuthLayout } from '@/features/auth';
import { toUserMessage } from '@/lib/errors';
import { authRedirectUrl } from '@/lib/redirect';
import { supabase } from '@/lib/supabase';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Podaj poprawny adres e-mail.');
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl('/auth/reset') });
    setBusy(false);
    if (error) return setError(toUserMessage(error));
    setSent(true);
  }

  return (
    <AuthLayout title="Reset hasła" subtitle="Wyślemy link do ustawienia nowego hasła.">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {sent ? (
        <Banner tone="success">Jeśli konto z tym adresem istnieje, wysłaliśmy link do zmiany hasła. Link jest ważny przez godzinę.</Banner>
      ) : (
        <>
          <TextField label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" required />
          <Button title="Wyślij link" onPress={submit} loading={busy} />
        </>
      )}
      <Link href="/sign-in" style={{ textAlign: 'center', textDecorationLine: 'underline' }}>
        <AppText>Wróć do logowania</AppText>
      </Link>
    </AuthLayout>
  );
}
