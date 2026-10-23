import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Pill, Row, Screen, SectionTitle, useToast } from '@/components/ui';
import { InviteDialog } from '@/features/admin/invite-dialog';
import { AdminOnly } from '@/features/guards';
import { useCompany, useSession } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatTimestamp } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { ROLE_LABEL, type Role } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

type Member = {
  user_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  active: boolean;
  store_names: string[];
  crew_names: string[];
  joined_at: string;
};
type Invitation = { id: string; email: string; role: Role; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string };

function Users() {
  const { companyId, canWrite } = useCompany();
  const { user } = useSession();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deactivate, setDeactivate] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const members = useAsync(async () => (await unwrap(supabase.rpc('company_users', { p_company_id: companyId }))) as Member[], [companyId]);
  const invitations = useAsync(
    async () =>
      (await unwrap(
        supabase.from('invitations').select('id, email, role, expires_at, accepted_at, revoked_at, created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50),
      )) as Invitation[],
    [companyId],
  );
  const now = new Date().toISOString();
  const open = (invitations.data ?? []).filter((i) => !i.accepted_at && !i.revoked_at);

  async function setActive(m: Member, active: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc('set_member_active', { p_company_id: companyId, p_user_id: m.user_id, p_active: active });
    setBusy(false);
    setDeactivate(null);
    if (error) return toast(toUserMessage(error), 'error');
    toast(active ? 'Użytkownik aktywowany.' : 'Użytkownik dezaktywowany. Historia została zachowana.');
    members.reload();
  }

  async function revoke(i: Invitation) {
    const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: i.id });
    if (error) return toast(toUserMessage(error), 'error');
    toast('Zaproszenie wycofane.');
    invitations.reload();
  }

  return (
    <Screen>
      <PageHeader
        title="Użytkownicy"
        subtitle="Każda osoba loguje się własnym kontem. Dostęp nadajesz zaproszeniem."
        actions={canWrite ? <Button title="Zaproś użytkownika" icon="person-add-outline" onPress={() => setInviteOpen(true)} /> : null}
      />
      {members.loading && !members.data ? <LoadingState /> : null}
      {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : null}
      <View style={{ gap: space.sm }}>
        {(members.data ?? []).map((m) => (
          <Card key={m.user_id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
              <Row wrap>
                <AppText variant="subheading">{m.full_name || m.email}</AppText>
                <Pill text={ROLE_LABEL[m.role]} tone="info" />
                {!m.active ? <Pill text="Nieaktywny" /> : null}
                {m.user_id === user?.id ? <Pill text="To Ty" tone="success" /> : null}
              </Row>
              <AppText variant="muted">{[m.email, m.phone, ...m.store_names.map((s) => `Sklep: ${s}`), ...m.crew_names.map((c) => `Ekipa: ${c}`)].filter(Boolean).join(' · ')}</AppText>
            </View>
            {canWrite && m.user_id !== user?.id ? (
              m.active ? (
                <Button title="Dezaktywuj" variant="danger" compact onPress={() => setDeactivate(m)} />
              ) : (
                <Button title="Aktywuj" variant="secondary" compact onPress={() => setActive(m, true)} />
              )
            ) : null}
          </Card>
        ))}
      </View>

      <SectionTitle>Oczekujące zaproszenia</SectionTitle>
      {invitations.data && open.length === 0 ? <EmptyState title="Brak oczekujących zaproszeń" icon="mail-outline" /> : null}
      <View style={{ gap: space.sm }}>
        {open.map((i) => (
          <Card key={i.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <AppText style={{ fontWeight: '600' }}>{i.email}</AppText>
              <AppText variant="muted">
                {`${ROLE_LABEL[i.role]} · ${i.expires_at < now ? 'wygasło' : `ważne do ${formatTimestamp(i.expires_at)}`}`}
              </AppText>
            </View>
            {i.expires_at < now ? <Pill text="Wygasło" tone="warning" /> : null}
            {canWrite ? <Button title="Wycofaj" variant="danger" compact onPress={() => revoke(i)} /> : null}
          </Card>
        ))}
      </View>

      <InviteDialog visible={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={invitations.reload} />
      <ConfirmDialog
        visible={!!deactivate}
        title="Dezaktywować użytkownika?"
        message={`${deactivate?.email} straci dostęp do Flowmont w tej firmie. Zlecenia i historia pozostaną bez zmian. Konto można później aktywować ponownie.`}
        confirmLabel="Dezaktywuj"
        destructive
        loading={busy}
        onClose={() => setDeactivate(null)}
        onConfirm={() => deactivate && setActive(deactivate, false)}
      />
    </Screen>
  );
}

export default function UsersRoute() {
  return (
    <AdminOnly>
      <Users />
    </AdminOnly>
  );
}
