import { Redirect, router } from 'expo-router';
import { View } from 'react-native';

import { AppText, Banner, Button, Card, LoadingState, PageHeader, Row, Screen, SectionTitle } from '@/components/ui';
import { JOB_SELECT } from '@/features/jobs/api';
import { JobRow } from '@/features/jobs/job-detail';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { addDays, formatDateLong, formatTimestamp, todayWarsaw } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import type { Job } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

function Stat({ label, value, onPress, tone }: { label: string; value: number | string; onPress?: () => void; tone?: 'warning' | 'danger' }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 180, flexShrink: 1, gap: 4 }}>
      <AppText variant="muted">{label}</AppText>
      <AppText variant="title" style={tone === 'warning' ? { color: colors.warningText } : tone === 'danger' ? { color: colors.danger } : undefined}>
        {String(value)}
      </AppText>
      {onPress ? <Button title="Pokaż" variant="ghost" compact onPress={onPress} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

function AdminDashboard() {
  const { companyId, company, name, canWrite } = useCompany();
  const today = todayWarsaw();
  const in7 = addDays(today, 7);
  const data = useAsync(async () => {
    const [pending, upcoming, failed] = await Promise.all([
      unwrap(supabase.from('jobs').select(JOB_SELECT).eq('company_id', companyId).eq('status', 'pending').order('requested_start').limit(5)),
      unwrap(
        supabase
          .from('jobs')
          .select(JOB_SELECT)
          .eq('company_id', companyId)
          .in('status', ['confirmed', 'in_progress'])
          .lte('confirmed_start', in7)
          .gte('confirmed_end', today)
          .order('confirmed_start')
          .limit(20),
      ),
      supabase.from('notification_outbox').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'failed'),
    ]);
    const pendingCount = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending');
    return { pending: pending as Job[], upcoming: upcoming as Job[], failed: failed.count ?? 0, pendingCount: pendingCount.count ?? 0 };
  }, [companyId, today]);

  const todayJobs = (data.data?.upcoming ?? []).filter((j) => j.confirmed_start! <= today && j.confirmed_end! >= today);

  return (
    <Screen>
      <PageHeader title="Pulpit" subtitle={`${name} · ${formatDateLong(today)}`} actions={canWrite ? <Button title="Nowe zlecenie" icon="add" onPress={() => router.push('/jobs/new')} /> : null} />
      {company.subscription_status === 'trialing' && company.access_level === 'full' ? (
        <Banner tone="info" title="Okres próbny">{`Pełny dostęp do ${formatTimestamp(company.trial_ends_at)}. Subskrypcję możesz wykupić w zakładce „Subskrypcja”.`}</Banner>
      ) : null}
      {data.loading && !data.data ? <LoadingState /> : null}
      {data.data ? (
        <>
          <Row wrap gap={space.md}>
            <Stat label="Oczekujące zgłoszenia" value={data.data.pendingCount} tone={data.data.pendingCount ? 'warning' : undefined} onPress={() => router.push('/requests')} />
            <Stat label="Montaże dziś" value={todayJobs.length} onPress={() => router.push('/plan')} />
            <Stat label="Montaże w ciągu 7 dni" value={data.data.upcoming.length} onPress={() => router.push('/calendar')} />
            {data.data.failed ? <Stat label="Nieudane powiadomienia" value={data.data.failed} tone="danger" onPress={() => router.push('/notifications')} /> : null}
          </Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'flex-start' }}>
            <Card style={{ flexGrow: 1, flexBasis: 360, flexShrink: 1 }}>
              <SectionTitle right={<Button title="Wszystkie" variant="ghost" compact onPress={() => router.push('/requests')} />}>Oczekujące zgłoszenia</SectionTitle>
              {data.data.pending.length === 0 ? <AppText variant="muted">Brak zgłoszeń do rozpatrzenia.</AppText> : null}
              {data.data.pending.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </Card>
            <Card style={{ flexGrow: 1, flexBasis: 360, flexShrink: 1 }}>
              <SectionTitle right={<Button title="Kalendarz" variant="ghost" compact onPress={() => router.push('/calendar')} />}>Najbliższe montaże</SectionTitle>
              {data.data.upcoming.length === 0 ? <AppText variant="muted">Brak potwierdzonych montaży w ciągu 7 dni.</AppText> : null}
              {data.data.upcoming.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </Card>
          </View>
        </>
      ) : null}
      {data.error ? <Banner tone="danger">{data.error}</Banner> : null}
    </Screen>
  );
}

export default function Home() {
  const { role } = useCompany();
  if (role === 'store_user') return <Redirect href="/calendar" />;
  if (role === 'crew_member') return <Redirect href="/plan" />;
  return <AdminDashboard />;
}

