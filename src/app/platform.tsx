import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, ConfirmDialog, ErrorState, KeyValue, LoadingState, PageHeader, Pill, Row, Screen, TextField, useToast } from '@/components/ui';
import { useSession } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatTimestamp } from '@/lib/dates';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

const SUB_LABEL: Record<string, string> = {
  trialing: 'Okres próbny',
  active: 'Aktywna',
  past_due: 'Zaległa płatność',
  cancelled: 'Anulowana',
  expired: 'Wygasła',
};

type Row_ = {
  company_id: string;
  name: string;
  status: 'active' | 'suspended';
  is_demo: boolean;
  created_at: string;
  trial_ends_at: string;
  subscription_status: string;
  access_level: string;
  admin_emails: string[];
  member_count: number;
  store_count: number;
  job_count: number;
};

export default function Platform() {
  const { isPlatformOwner, loading } = useSession();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [suspend, setSuspend] = useState<Row_ | null>(null);
  const data = useAsync(async () => (await unwrap(supabase.rpc('platform_companies'))) as Row_[], [], isPlatformOwner);

  if (loading) return <LoadingState />;
  if (!isPlatformOwner) {
    return (
      <Screen>
        <Banner tone="warning">Brak dostępu.</Banner>
      </Screen>
    );
  }

  async function setStatus(r: Row_, status: 'active' | 'suspended') {
    const { error } = await supabase.rpc('platform_set_company_status', { p_company_id: r.company_id, p_status: status });
    setSuspend(null);
    if (error) return toast(toUserMessage(error), 'error');
    toast(status === 'active' ? 'Dostęp przywrócony.' : 'Dostęp zawieszony.');
    data.reload();
  }

  async function extend(r: Row_) {
    const { error } = await supabase.rpc('platform_extend_trial', { p_company_id: r.company_id, p_days: 7 });
    if (error) return toast(toUserMessage(error), 'error');
    toast('Okres próbny przedłużony o 7 dni.');
    data.reload();
  }

  const rows = (data.data ?? []).filter((r) => !search.trim() || `${r.name} ${r.admin_emails.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Screen>
      <Button title="Wróć do aplikacji" variant="ghost" icon="arrow-back" onPress={() => router.replace('/')} style={{ alignSelf: 'flex-start' }} />
      <PageHeader title="Platforma" subtitle="Konta firm montażowych. Widoczne są wyłącznie dane operacyjne – bez szczegółów zleceń i plików klientów." />
      <TextField label="Szukaj firmy" value={search} onChangeText={setSearch} />
      {data.loading && !data.data ? <LoadingState /> : null}
      {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : null}
      <View style={{ gap: space.sm }}>
        {rows.map((r) => (
          <Card key={r.company_id}>
            <Row wrap style={{ justifyContent: 'space-between' }}>
              <Row wrap>
                <AppText variant="subheading">{r.name}</AppText>
                {r.is_demo ? <Pill text="Demo" tone="info" /> : null}
                <Pill text={r.access_level === 'full' ? 'Pełny dostęp' : r.access_level === 'suspended' ? 'Zawieszona' : 'Tylko odczyt'} tone={r.access_level === 'full' ? 'success' : r.access_level === 'suspended' ? 'danger' : 'warning'} />
              </Row>
              <Row wrap>
                <Button title="+7 dni próby" variant="secondary" compact onPress={() => extend(r)} />
                {r.status === 'active' ? (
                  <Button title="Zawieś dostęp" variant="danger" compact onPress={() => setSuspend(r)} />
                ) : (
                  <Button title="Przywróć dostęp" compact onPress={() => setStatus(r, 'active')} />
                )}
              </Row>
            </Row>
            <Row wrap gap={space.xl}>
              <KeyValue label="Utworzono" value={formatTimestamp(r.created_at)} />
              <KeyValue label="Koniec próby" value={formatTimestamp(r.trial_ends_at)} />
              <KeyValue label="Subskrypcja" value={SUB_LABEL[r.subscription_status] ?? r.subscription_status} />
              <KeyValue label="Administratorzy" value={r.admin_emails.join(', ')} />
              <KeyValue label="Użytkownicy / sklepy / zlecenia" value={`${r.member_count} / ${r.store_count} / ${r.job_count}`} />
            </Row>
          </Card>
        ))}
      </View>
      <ConfirmDialog
        visible={!!suspend}
        title="Zawiesić dostęp firmy?"
        message={`Użytkownicy firmy ${suspend?.name} stracą możliwość pracy w Flowmont. Dane zostaną zachowane.`}
        confirmLabel="Zawieś"
        destructive
        onClose={() => setSuspend(null)}
        onConfirm={() => suspend && setStatus(suspend, 'suspended')}
      />
    </Screen>
  );
}
