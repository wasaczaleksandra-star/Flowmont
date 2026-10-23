import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, Dialog, ErrorState, LoadingState, PageHeader, Pill, Row, Screen, SelectField, TextField, useToast } from '@/components/ui';
import { InviteDialog } from '@/features/admin/invite-dialog';
import { fetchCrews } from '@/features/jobs/api';
import { AdminOnly } from '@/features/guards';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Crew } from '@/lib/types';
import { space } from '@/theme/tokens';

const COLORS = ['#2F8EE0', '#00457F', '#EC6206', '#FFA723', '#1E7A46', '#7A4BC2'];

function Crews() {
  const { companyId, canWrite } = useCompany();
  const toast = useToast();
  const [editing, setEditing] = useState<Crew | 'new' | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [inviteCrew, setInviteCrew] = useState<string | null>(null);
  const [addMemberTo, setAddMemberTo] = useState<Crew | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);

  const crews = useAsync(() => fetchCrews(companyId, true), [companyId]);
  const members = useAsync(async () => {
    const [cm, users] = await Promise.all([
      unwrap(supabase.from('crew_members').select('crew_id, user_id').eq('company_id', companyId)),
      unwrap(supabase.rpc('company_users', { p_company_id: companyId })),
    ]);
    return { cm: cm as { crew_id: string; user_id: string }[], users: users as { user_id: string; email: string; full_name: string; role: string; active: boolean }[] };
  }, [companyId]);

  function openEdit(c: Crew | 'new') {
    setEditing(c);
    setName(c === 'new' ? '' : c.name);
    setColor(c === 'new' ? COLORS[0] : c.color);
    setError(null);
  }

  async function save() {
    if (!name.trim()) return setError('Podaj nazwę ekipy.');
    const res =
      editing === 'new'
        ? await supabase.from('crews').insert({ company_id: companyId, name: name.trim(), color })
        : await supabase.from('crews').update({ name: name.trim(), color }).eq('id', (editing as Crew).id);
    if (res.error) return setError(toUserMessage(res.error));
    toast('Zapisano ekipę.');
    setEditing(null);
    crews.reload();
  }

  async function toggle(c: Crew) {
    if (c.active && (crews.data ?? []).filter((x) => x.active).length <= 1) {
      return toast('Firma musi mieć co najmniej jedną aktywną ekipę.', 'error');
    }
    const { error } = await supabase.from('crews').update({ active: !c.active }).eq('id', c.id);
    if (error) return toast(toUserMessage(error), 'error');
    toast(c.active ? 'Ekipa dezaktywowana. Potwierdzone zlecenia pozostają przypisane.' : 'Ekipa aktywowana.');
    crews.reload();
  }

  async function addMember() {
    if (!addMemberTo || !memberId) return;
    const { error } = await supabase.from('crew_members').insert({ crew_id: addMemberTo.id, company_id: companyId, user_id: memberId });
    if (error) return toast(toUserMessage(error), 'error');
    setAddMemberTo(null);
    setMemberId(null);
    members.reload();
  }

  async function removeMember(crewId: string, userId: string) {
    const { error } = await supabase.from('crew_members').delete().eq('crew_id', crewId).eq('user_id', userId);
    if (error) return toast(toUserMessage(error), 'error');
    members.reload();
  }

  const userLabel = (id: string) => {
    const u = members.data?.users.find((x) => x.user_id === id);
    return u ? u.full_name || u.email : 'Użytkownik';
  };

  return (
    <Screen>
      <PageHeader
        title="Ekipy"
        subtitle="Każda ekipa może mieć tylko jedno aktywne zlecenie w danym dniu. Firmy z jedną ekipą korzystają z ekipy domyślnej."
        actions={canWrite ? <Button title="Dodaj ekipę" icon="add" onPress={() => openEdit('new')} /> : null}
      />
      {crews.loading && !crews.data ? <LoadingState /> : null}
      {crews.error ? <ErrorState message={crews.error} onRetry={crews.reload} /> : null}
      <View style={{ gap: space.md }}>
        {(crews.data ?? []).map((c) => {
          const cm = (members.data?.cm ?? []).filter((m) => m.crew_id === c.id);
          return (
            <Card key={c.id}>
              <Row wrap style={{ justifyContent: 'space-between' }}>
                <Row>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.color }} />
                  <AppText variant="subheading">{c.name}</AppText>
                  {c.is_default ? <Pill text="Domyślna" tone="info" /> : null}
                  {!c.active ? <Pill text="Nieaktywna" /> : null}
                </Row>
                {canWrite ? (
                  <Row wrap>
                    <Button title="Edytuj" variant="secondary" compact onPress={() => openEdit(c)} />
                    <Button title={c.active ? 'Dezaktywuj' : 'Aktywuj'} variant={c.active ? 'danger' : 'secondary'} compact onPress={() => toggle(c)} />
                  </Row>
                ) : null}
              </Row>
              <AppText variant="label">Członkowie ekipy</AppText>
              {cm.length === 0 ? <AppText variant="muted">Brak przypisanych osób. Montażyści mogą też korzystać z planu dnia na koncie administratora.</AppText> : null}
              {cm.map((m) => (
                <Row key={m.user_id} style={{ justifyContent: 'space-between' }}>
                  <AppText>{userLabel(m.user_id)}</AppText>
                  {canWrite ? <Button title="Usuń z ekipy" variant="ghost" compact onPress={() => removeMember(c.id, m.user_id)} /> : null}
                </Row>
              ))}
              {canWrite && c.active ? (
                <Row wrap>
                  <Button title="Zaproś montażystę" variant="secondary" compact icon="person-add-outline" onPress={() => setInviteCrew(c.id)} />
                  <Button title="Dodaj istniejącego użytkownika" variant="ghost" compact onPress={() => setAddMemberTo(c)} />
                </Row>
              ) : null}
            </Card>
          );
        })}
      </View>

      <Dialog
        visible={!!editing}
        title={editing === 'new' ? 'Nowa ekipa' : 'Edytuj ekipę'}
        onClose={() => setEditing(null)}
        width={440}
        footer={
          <>
            <Button title="Anuluj" variant="secondary" onPress={() => setEditing(null)} />
            <Button title="Zapisz" onPress={save} />
          </>
        }>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <TextField label="Nazwa ekipy" value={name} onChangeText={setName} required />
        <AppText variant="label">Kolor w kalendarzu</AppText>
        <Row wrap>
          {COLORS.map((c) => (
            <Button key={c} title={c === color ? '✓' : ' '} compact onPress={() => setColor(c)} style={{ backgroundColor: c, borderColor: c, minWidth: 44 }} accessibilityLabel={`Kolor ${c}`} />
          ))}
        </Row>
      </Dialog>
      <Dialog
        visible={!!addMemberTo}
        title={`Dodaj do: ${addMemberTo?.name ?? ''}`}
        onClose={() => setAddMemberTo(null)}
        width={440}
        footer={
          <>
            <Button title="Anuluj" variant="secondary" onPress={() => setAddMemberTo(null)} />
            <Button title="Dodaj" onPress={addMember} disabled={!memberId} />
          </>
        }>
        <SelectField
          label="Użytkownik"
          value={memberId}
          onChange={setMemberId}
          options={(members.data?.users ?? [])
            .filter((u) => u.active && (u.role === 'crew_member' || u.role === 'admin'))
            .filter((u) => !(members.data?.cm ?? []).some((m) => m.crew_id === addMemberTo?.id && m.user_id === u.user_id))
            .map((u) => ({ value: u.user_id, label: u.full_name || u.email, description: u.email }))}
        />
      </Dialog>
      <InviteDialog visible={!!inviteCrew} onClose={() => setInviteCrew(null)} presetRole="crew_member" presetCrewId={inviteCrew ?? undefined} onInvited={members.reload} />
    </Screen>
  );
}

export default function CrewsRoute() {
  return (
    <AdminOnly>
      <Crews />
    </AdminOnly>
  );
}
