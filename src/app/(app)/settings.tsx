import { useState } from 'react';

import { Banner, Button, Card, ErrorState, LoadingState, PageHeader, Screen, SectionTitle, TextField, useToast } from '@/components/ui';
import { AdminOnly } from '@/features/guards';
import { useCompany, useSession } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Company = { name: string; nip: string | null; email: string | null; phone: string | null; address: string | null; notification_email: string | null; notification_phone: string | null };

function Settings() {
  const { companyId, canWrite } = useCompany();
  const { reloadCompanies } = useSession();
  const toast = useToast();
  const data = useAsync(async () => (await unwrap(supabase.from('companies').select('name, nip, email, phone, address, notification_email, notification_phone').eq('id', companyId).single())) as Company, [companyId]);
  const [f, setF] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<Company | null>(null);
  if (data.data && data.data !== loaded) {
    setLoaded(data.data);
    setF(data.data);
  }

  if (data.loading && !f) return <LoadingState />;
  if (data.error || !f) return <ErrorState message={data.error ?? ''} onRetry={data.reload} />;
  const set = (k: keyof Company) => (v: string) => setF((s) => ({ ...(s as Company), [k]: v }));

  async function save() {
    setError(null);
    if (!f!.name.trim()) return setError('Podaj nazwę firmy.');
    for (const k of ['email', 'notification_email'] as const) {
      if (f![k]?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f![k]!.trim())) return setError('Podaj poprawny adres e-mail.');
    }
    setBusy(true);
    const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
    const { error } = await supabase
      .from('companies')
      .update({
        name: f!.name.trim(),
        nip: clean(f!.nip),
        email: clean(f!.email),
        phone: clean(f!.phone),
        address: clean(f!.address),
        notification_email: clean(f!.notification_email),
        notification_phone: clean(f!.notification_phone),
      })
      .eq('id', companyId);
    setBusy(false);
    if (error) return setError(toUserMessage(error));
    toast('Ustawienia zapisane.');
    reloadCompanies();
  }

  return (
    <Screen maxWidth={760}>
      <PageHeader title="Ustawienia firmy" />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Card>
        <SectionTitle>Dane firmy</SectionTitle>
        <TextField label="Nazwa firmy" value={f.name} onChangeText={set('name')} required />
        <TextField label="NIP" value={f.nip ?? ''} onChangeText={set('nip')} keyboardType="number-pad" />
        <TextField label="E-mail firmowy" value={f.email ?? ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <TextField label="Telefon" value={f.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" />
        <TextField label="Adres" value={f.address ?? ''} onChangeText={set('address')} />
      </Card>
      <Card>
        <SectionTitle>Odbiorcy powiadomień firmy</SectionTitle>
        <Banner tone="info">
          Nowe zgłoszenia i zwolnione terminy trafiają do wszystkich administratorów (wg ich preferencji w „Moje konto”) oraz na poniższe adresy.
        </Banner>
        <TextField label="Dodatkowy e-mail do powiadomień" value={f.notification_email ?? ''} onChangeText={set('notification_email')} keyboardType="email-address" autoCapitalize="none" placeholder="np. biuro@firma.pl" />
        <TextField label="Dodatkowy numer do SMS" value={f.notification_phone ?? ''} onChangeText={set('notification_phone')} keyboardType="phone-pad" />
      </Card>
      <Button title="Zapisz ustawienia" onPress={save} loading={busy} disabled={!canWrite} style={{ alignSelf: 'flex-start' }} />
    </Screen>
  );
}

export default function SettingsRoute() {
  return (
    <AdminOnly>
      <Settings />
    </AdminOnly>
  );
}
