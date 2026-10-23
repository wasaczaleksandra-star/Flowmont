import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Checkbox, Divider, KeyValue, TextField } from '@/components/ui';
import { AuthLayout } from '@/features/auth';
import { useSession } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { usePendingRedirect } from '@/hooks/use-pending-redirect';
import { formatTimestamp } from '@/lib/dates';
import { errorCode, toUserMessage } from '@/lib/errors';
import { ROLE_LABEL, type Role } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

export default function Onboarding() {
  const { user, signOut, reloadCompanies, setActiveCompany, isPlatformOwner } = useSession();
  usePendingRedirect();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nip, setNip] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAnother, setConfirmAnother] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const invitations = useAsync(
    async () => unwrap(supabase.rpc('my_pending_invitations')) as Promise<{ company_name: string; role: Role; expires_at: string }[]>,
    [user?.id],
  );

  async function create() {
    setError(null);
    if (name.trim().length < 2) return setError('Podaj nazwę firmy (min. 2 znaki).');
    setBusy(true);
    const { data, error } = await supabase.rpc('create_company', {
      p_name: name.trim(),
      p_phone: phone.trim() || null,
      p_nip: nip.trim() || null,
      p_allow_additional: confirmAnother,
    });
    setBusy(false);
    if (error) {
      if (errorCode(error) === 'already_admin') setNeedsConfirm(true);
      return setError(toUserMessage(error));
    }
    await reloadCompanies();
    setActiveCompany((data as any).id);
  }

  const pending = invitations.data ?? [];

  return (
    <AuthLayout title="Witaj w Flowmont" subtitle={`Zalogowano jako ${user?.email}`}>
      {pending.length > 0 ? (
        <Banner tone="info" title="Masz oczekujące zaproszenie">
          <View style={{ gap: space.sm }}>
            {pending.map((p, i) => (
              <AppText key={i}>
                {`${p.company_name} – ${ROLE_LABEL[p.role]} (ważne do ${formatTimestamp(p.expires_at)}). Otwórz link z wiadomości e-mail, aby dołączyć – nie zakładaj nowej firmy.`}
              </AppText>
            ))}
          </View>
        </Banner>
      ) : (
        <AppText variant="muted">
          Jeśli współpracujesz z firmą montażową jako sklep lub członek ekipy, otwórz link z zaproszenia, które otrzymałeś e-mailem.
        </AppText>
      )}
      <Divider />
      <AppText variant="subheading">Załóż konto firmy montażowej</AppText>
      <AppText variant="muted">Otrzymasz 3 dni bezpłatnego okresu próbnego z pełnym dostępem.</AppText>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField label="Nazwa firmy" value={name} onChangeText={setName} required autoComplete="organization" />
      <TextField label="Telefon (opcjonalnie)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextField label="NIP (opcjonalnie)" value={nip} onChangeText={setNip} keyboardType="number-pad" />
      {needsConfirm ? <Checkbox label="Tak, chcę utworzyć kolejną firmę" value={confirmAnother} onChange={setConfirmAnother} /> : null}
      <Button title="Utwórz firmę i rozpocznij okres próbny" onPress={create} loading={busy} />
      {isPlatformOwner ? <Button title="Panel platformy" variant="secondary" icon="shield-checkmark-outline" onPress={() => router.push('/platform')} /> : null}
      <Divider />
      <KeyValue label="Nie to konto?">
        <Button title="Wyloguj się" variant="ghost" icon="log-out-outline" onPress={signOut} />
      </KeyValue>
    </AuthLayout>
  );
}
