import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, Checkbox, KeyValue, LoadingState, PageHeader, Row, Screen, SectionTitle, TextField, useToast } from '@/components/ui';
import { useCompany, useSession } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { toUserMessage } from '@/lib/errors';
import { ROLE_LABEL, type Role } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

const EVENTS: Record<Role, { key: string; label: string }[]> = {
  admin: [
    { key: 'job_requested', label: 'Nowe zgłoszenie od sklepu' },
    { key: 'job_withdrawn', label: 'Sklep wycofał zgłoszenie' },
    { key: 'date_released', label: 'Zwolnił się termin' },
  ],
  store_user: [
    { key: 'job_confirmed', label: 'Montaż potwierdzony' },
    { key: 'job_rejected', label: 'Zgłoszenie odrzucone' },
    { key: 'job_rescheduled', label: 'Zmiana terminu' },
    { key: 'job_cancelled', label: 'Montaż anulowany' },
    { key: 'job_completed', label: 'Montaż zakończony' },
    { key: 'announcement', label: 'Ogłoszenia o wolnych terminach' },
  ],
  crew_member: [
    { key: 'job_confirmed', label: 'Nowe zlecenie dla ekipy' },
    { key: 'job_rescheduled', label: 'Zmiana terminu' },
    { key: 'job_cancelled', label: 'Montaż anulowany' },
  ],
};

type Pref = { event_type: string; email_enabled: boolean; sms_enabled: boolean };

export default function Account() {
  const { user, signOut, companies, setActiveCompany } = useSession();
  const { companyId, role, name } = useCompany();
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const profile = useAsync(async () => (await unwrap(supabase.from('profiles').select('full_name, phone, email').eq('id', user!.id).single())) as { full_name: string; phone: string | null; email: string }, [user?.id]);
  const prefs = useAsync(async () => (await unwrap(supabase.from('notification_preferences').select('event_type, email_enabled, sms_enabled').eq('company_id', companyId).eq('user_id', user!.id))) as Pref[], [companyId, user?.id]);

  const [loadedProfile, setLoadedProfile] = useState<typeof profile.data>(null);
  if (profile.data && profile.data !== loadedProfile) {
    setLoadedProfile(profile.data);
    setFullName(profile.data.full_name);
    setPhone(profile.data.phone ?? '');
  }

  async function saveProfile() {
    if (phone.trim() && !/^\+?[0-9]{9,15}$/.test(phone.replace(/[\s\-()]/g, ''))) return toast('Podaj poprawny numer telefonu.', 'error');
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone: phone.trim() || null }).eq('id', user!.id);
    setBusy(false);
    if (error) return toast(toUserMessage(error), 'error');
    toast('Zapisano profil.');
  }

  const get = (key: string): Pref => prefs.data?.find((p) => p.event_type === key) ?? { event_type: key, email_enabled: true, sms_enabled: false };

  async function setPref(key: string, patch: Partial<Pref>) {
    const next = { ...get(key), ...patch };
    prefs.setData([...(prefs.data ?? []).filter((p) => p.event_type !== key), next]);
    const { error } = await supabase.from('notification_preferences').upsert({ company_id: companyId, user_id: user!.id, ...next });
    if (error) {
      toast(toUserMessage(error), 'error');
      prefs.reload();
    }
  }

  return (
    <Screen maxWidth={760}>
      <PageHeader title="Moje konto" subtitle={`${user?.email} · ${ROLE_LABEL[role]} w firmie ${name}`} />
      <Card>
        <SectionTitle>Profil</SectionTitle>
        {profile.loading && !profile.data ? <LoadingState /> : null}
        <TextField label="Imię i nazwisko" value={fullName} onChangeText={setFullName} />
        <TextField label="Telefon (do powiadomień SMS)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button title="Zapisz profil" onPress={saveProfile} loading={busy} style={{ alignSelf: 'flex-start' }} />
      </Card>
      <Card>
        <SectionTitle>Powiadomienia</SectionTitle>
        {!phone.trim() ? <Banner tone="info">Aby otrzymywać SMS-y, dodaj numer telefonu w profilu.</Banner> : null}
        {EVENTS[role].map((e) => (
          <View key={e.key} style={{ gap: 2 }}>
            <AppText style={{ fontWeight: '600' }}>{e.label}</AppText>
            <Row wrap gap={space.lg}>
              <Checkbox label="E-mail" value={get(e.key).email_enabled} onChange={(v) => setPref(e.key, { email_enabled: v })} />
              <Checkbox label="SMS" value={get(e.key).sms_enabled} onChange={(v) => setPref(e.key, { sms_enabled: v })} disabled={!phone.trim()} />
            </Row>
          </View>
        ))}
      </Card>
      {companies.length > 1 ? (
        <Card>
          <SectionTitle>Moje firmy</SectionTitle>
          {companies.map((c) => (
            <Row key={c.company_id} wrap style={{ justifyContent: 'space-between' }}>
              <KeyValue label={ROLE_LABEL[c.role]} value={c.name} />
              {c.company_id === companyId ? (
                <AppText variant="muted">Aktywna</AppText>
              ) : (
                <Button title="Przełącz" variant="secondary" compact onPress={() => { setActiveCompany(c.company_id); router.replace('/'); }} />
              )}
            </Row>
          ))}
        </Card>
      ) : null}
      <Card>
        <SectionTitle>Sesja</SectionTitle>
        <AppText variant="muted">Wyloguj się, aby zalogować się innym kontem (np. kontem sklepu lub ekipy).</AppText>
        <Button title="Wyloguj się" variant="danger" icon="log-out-outline" onPress={signOut} style={{ alignSelf: 'flex-start' }} />
      </Card>
    </Screen>
  );
}
