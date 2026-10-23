import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

import { AppText, Banner, Button, ChoiceChips, Dialog, SelectField, TextField, useToast } from '@/components/ui';
import { fetchCrews, fetchStores, kickNotifications } from '@/features/jobs/api';
import { useCompany } from '@/features/session';
import { useAsync } from '@/hooks/use-async';
import { formatTimestamp } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { authRedirectUrl } from '@/lib/redirect';
import { ROLE_LABEL, type Role } from '@/lib/status';
import { supabase } from '@/lib/supabase';

/** Invites a user by e-mail. Each person gets their own account – no shared logins. */
export function InviteDialog({
  visible,
  onClose,
  onInvited,
  presetRole,
  presetStoreId,
  presetCrewId,
  presetEmail,
}: {
  visible: boolean;
  onClose: () => void;
  onInvited?: () => void;
  presetRole?: Role;
  presetStoreId?: string;
  presetCrewId?: string;
  presetEmail?: string;
}) {
  const { companyId } = useCompany();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('store_user');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [crewId, setCrewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string; expires: string } | null>(null);
  const stores = useAsync(() => fetchStores(companyId), [companyId], visible);
  const crews = useAsync(() => fetchCrews(companyId), [companyId], visible);

  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setEmail(presetEmail ?? '');
      setRole(presetRole ?? 'store_user');
      setStoreId(presetStoreId ?? null);
      setCrewId(presetCrewId ?? null);
      setError(null);
      setResult(null);
    }
  }

  async function send() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Podaj poprawny adres e-mail.');
    if (role === 'store_user' && !storeId) return setError('Wybierz sklep.');
    if (role === 'crew_member' && !crewId) return setError('Wybierz ekipę.');
    setBusy(true);
    const { data, error } = await supabase.rpc('create_invitation', {
      p_company_id: companyId,
      p_email: email.trim(),
      p_role: role,
      p_store_id: role === 'store_user' ? storeId : null,
      p_crew_id: role === 'crew_member' ? crewId : null,
    });
    setBusy(false);
    if (error) return setError(toUserMessage(error));
    kickNotifications();
    const r = data as { path: string; expires_at: string };
    setResult({ link: authRedirectUrl(r.path), expires: r.expires_at });
    onInvited?.();
  }

  return (
    <Dialog
      visible={visible}
      title="Zaproś użytkownika"
      onClose={onClose}
      footer={
        result ? (
          <Button title="Gotowe" onPress={onClose} />
        ) : (
          <>
            <Button title="Anuluj" variant="secondary" onPress={onClose} />
            <Button title="Wyślij zaproszenie" icon="send" onPress={send} loading={busy} />
          </>
        )
      }>
      {result ? (
        <>
          <Banner tone="success" title="Zaproszenie utworzone">
            {`Wiadomość z zaproszeniem trafiła do kolejki wysyłki. Link jest ważny do ${formatTimestamp(result.expires)}.`}
          </Banner>
          <AppText variant="muted">Możesz też przekazać link samodzielnie. Osoba musi zalogować się adresem, na który wysłano zaproszenie.</AppText>
          <TextField label="Link zaproszenia" value={result.link} editable={false} selectTextOnFocus />
          <Button
            title="Kopiuj link"
            variant="secondary"
            icon="copy-outline"
            onPress={async () => {
              await Clipboard.setStringAsync(result.link);
              toast('Skopiowano link.');
            }}
          />
        </>
      ) : (
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <TextField label="E-mail osoby zapraszanej" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" required />
          <ChoiceChips<Role>
            label="Rola"
            value={role}
            onChange={setRole}
            options={(['store_user', 'crew_member', 'admin'] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          {role === 'store_user' ? (
            <SelectField label="Sklep" required value={storeId} onChange={setStoreId} options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          ) : null}
          {role === 'crew_member' ? (
            <SelectField label="Ekipa" required value={crewId} onChange={setCrewId} options={(crews.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          ) : null}
          {role === 'admin' ? <Banner tone="warning">Administrator ma pełny dostęp do danych firmy, zleceń i ustawień.</Banner> : null}
        </>
      )}
    </Dialog>
  );
}
