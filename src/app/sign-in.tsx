import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Divider, TextField } from '@/components/ui';
import { AuthLayout, signInWithGoogle } from '@/features/auth';
import { env } from '@/lib/env';
import { toUserMessage } from '@/lib/errors';
import { setPendingNext } from '@/lib/pending';
import { authRedirectUrl, safeNextPath } from '@/lib/redirect';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

export default function SignIn() {
  const params = useLocalSearchParams<{ next?: string; email?: string }>();
  const next = params.next ? safeNextPath(params.next) : null;
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'link' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function withPassword() {
    setError(null);
    setInfo(null);
    if (!validEmail) return setError('Podaj poprawny adres e-mail.');
    if (!password) return setError('Podaj hasło albo zaloguj się linkiem.');
    setBusy('password');
    if (next) setPendingNext(next);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(null);
    if (error) setError(toUserMessage(error));
  }

  async function withLink() {
    setError(null);
    setInfo(null);
    if (!validEmail) return setError('Podaj poprawny adres e-mail.');
    setBusy('link');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: authRedirectUrl(`/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`),
      },
    });
    setBusy(null);
    if (error) {
      setError(/Signups not allowed|not found/i.test(error.message) ? 'Nie znaleziono konta z tym adresem. Załóż konto.' : toUserMessage(error));
    } else {
      setInfo('Wysłaliśmy link do logowania. Sprawdź skrzynkę e-mail (także folder SPAM).');
    }
  }

  async function withGoogle() {
    setError(null);
    setBusy('google');
    try {
      if (next) setPendingNext(next);
      await signInWithGoogle(next ?? undefined);
    } catch (e) {
      setError(toUserMessage(e, 'Logowanie przez Google nie powiodło się.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthLayout title="Zaloguj się" subtitle={next?.startsWith('/invite/') ? 'Zaloguj się kontem, na które przyszło zaproszenie.' : undefined}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {info ? <Banner tone="success">{info}</Banner> : null}
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        textContentType="username"
        required
      />
      <TextField
        label="Hasło"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={withPassword}
      />
      <Button title="Zaloguj się" onPress={withPassword} loading={busy === 'password'} />
      <Link href="/forgot-password" asChild>
        <AppText style={{ textAlign: 'center', textDecorationLine: 'underline' }} accessibilityRole="link">
          Nie pamiętam hasła
        </AppText>
      </Link>
      <Divider />
      <View style={{ gap: space.sm }}>
        <Button title="Wyślij link do logowania" variant="secondary" icon="mail-outline" onPress={withLink} loading={busy === 'link'} />
        {env.googleAuthEnabled ? (
          <Button title="Zaloguj się przez Google" variant="secondary" icon="logo-google" onPress={withGoogle} loading={busy === 'google'} />
        ) : null}
      </View>
      <AppText variant="muted" style={{ textAlign: 'center' }}>
        Nie masz konta?{' '}
        <Link href={{ pathname: '/sign-up', params: next ? { next } : {} }} style={{ textDecorationLine: 'underline', fontWeight: '600' }}>
          Załóż konto
        </Link>
      </AppText>
    </AuthLayout>
  );
}
