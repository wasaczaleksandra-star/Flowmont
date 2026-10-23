import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AppText, Banner, Button, KeyValue, LoadingState } from '@/components/ui';
import { AuthLayout } from '@/features/auth';
import { useSession } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { toUserMessage } from '@/lib/errors';
import { setPendingNext } from '@/lib/pending';
import { ROLE_LABEL, type Role } from '@/lib/status';
import { supabase } from '@/lib/supabase';

type InvitationInfo = {
  status: 'valid' | 'invalid' | 'expired' | 'revoked' | 'accepted';
  company_name: string | null;
  role: Role | null;
  email_hint: string | null;
  store_name: string | null;
  email_matches: boolean | null;
};

const STATUS_TEXT: Record<Exclude<InvitationInfo['status'], 'valid'>, string> = {
  invalid: 'Ten link zaproszenia jest nieprawidłowy. Sprawdź, czy skopiowano cały adres.',
  expired: 'To zaproszenie wygasło. Poproś administratora firmy montażowej o wysłanie nowego.',
  revoked: 'To zaproszenie zostało wycofane. Poproś administratora o nowe.',
  accepted: 'To zaproszenie zostało już wykorzystane.',
};

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, user, signOut, reloadCompanies, setActiveCompany } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/invite/${token}`;

  const { data, loading, error: loadError, reload } = useAsync(
    async () => {
      const rows = await unwrap(supabase.rpc('get_invitation', { p_token: token }));
      return (rows as InvitationInfo[])[0];
    },
    [token, user?.id],
  );

  async function accept() {
    setBusy(true);
    setError(null);
    const { data: res, error } = await supabase.rpc('accept_invitation', { p_token: token });
    if (error) {
      setBusy(false);
      return setError(toUserMessage(error));
    }
    await reloadCompanies();
    setActiveCompany((res as any).company_id);
    setBusy(false);
    router.replace('/');
  }

  if (loading && !data) {
    return (
      <AuthLayout title="Zaproszenie">
        <LoadingState />
      </AuthLayout>
    );
  }
  if (loadError || !data) {
    return (
      <AuthLayout title="Zaproszenie">
        <Banner tone="danger">{loadError ?? 'Nie udało się sprawdzić zaproszenia.'}</Banner>
        <Button title="Spróbuj ponownie" variant="secondary" onPress={reload} />
      </AuthLayout>
    );
  }

  if (data.status !== 'valid' && !(data.status === 'accepted' && session)) {
    return (
      <AuthLayout title="Zaproszenie nieaktywne">
        <Banner tone="warning">{STATUS_TEXT[data.status as keyof typeof STATUS_TEXT]}</Banner>
        <Button title={session ? 'Przejdź do Flowmont' : 'Przejdź do logowania'} onPress={() => router.replace(session ? '/' : '/sign-in')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Zaproszenie do Flowmont" subtitle={`Firma ${data.company_name} zaprasza Cię do współpracy.`}>
      <KeyValue label="Rola" value={data.role ? ROLE_LABEL[data.role] : null} />
      {data.store_name ? <KeyValue label="Sklep" value={data.store_name} /> : null}
      <KeyValue label="Zaproszenie dla" value={data.email_hint} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {!session ? (
        <>
          <AppText variant="muted">Zaloguj się lub załóż konto, używając adresu e-mail, na który przyszło zaproszenie.</AppText>
          <Button
            title="Zaloguj się"
            onPress={() => {
              setPendingNext(path);
              router.push({ pathname: '/sign-in', params: { next: path } });
            }}
          />
          <Button
            title="Załóż konto"
            variant="secondary"
            onPress={() => {
              setPendingNext(path);
              router.push({ pathname: '/sign-up', params: { next: path } });
            }}
          />
        </>
      ) : data.email_matches === false ? (
        <>
          <Banner tone="warning" title="Zalogowano innym kontem">
            {`Jesteś zalogowany jako ${user?.email}, a zaproszenie jest dla adresu ${data.email_hint}. Wyloguj się i zaloguj właściwym kontem.`}
          </Banner>
          <Button
            title="Wyloguj i zaloguj się innym kontem"
            onPress={async () => {
              setPendingNext(path);
              await signOut();
              router.replace({ pathname: '/sign-in', params: { next: path } });
            }}
          />
        </>
      ) : (
        <>
          <AppText variant="muted">{`Zalogowano jako ${user?.email}.`}</AppText>
          <Button title="Przyjmij zaproszenie" onPress={accept} loading={busy} />
        </>
      )}
    </AuthLayout>
  );
}
