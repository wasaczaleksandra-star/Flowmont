import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Banner, Button, LoadingState, TextField } from '@/components/ui';
import { AuthLayout, completeAuthFromParams } from '@/features/auth';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export default function ResetPassword() {
  const params = useLocalSearchParams();
  const [phase, setPhase] = useState<'verifying' | 'form' | 'error' | 'done'>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthFromParams(params as any)
      .then(() => setPhase('form'))
      .catch((e: Error) => {
        setError(e.message);
        setPhase('error');
      });
  }, [params]);

  async function save() {
    setError(null);
    if (password.length < 8) return setError('Hasło musi mieć co najmniej 8 znaków.');
    if (password !== repeat) return setError('Hasła nie są takie same.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(toUserMessage(error));
    setPhase('done');
  }

  return (
    <AuthLayout title="Ustaw nowe hasło">
      {phase === 'verifying' ? <LoadingState label="Sprawdzamy link…" /> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {phase === 'error' ? <Button title="Poproś o nowy link" onPress={() => router.replace('/forgot-password')} /> : null}
      {phase === 'form' ? (
        <>
          <TextField label="Nowe hasło" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" required />
          <TextField label="Powtórz hasło" value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" required />
          <Button title="Zapisz hasło" onPress={save} loading={busy} />
        </>
      ) : null}
      {phase === 'done' ? (
        <>
          <Banner tone="success">Hasło zostało zmienione. Jesteś zalogowany.</Banner>
          <Button title="Przejdź do Flowmont" onPress={() => router.replace('/')} />
        </>
      ) : null}
    </AuthLayout>
  );
}
