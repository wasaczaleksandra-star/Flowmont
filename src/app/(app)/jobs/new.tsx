import { useLocalSearchParams } from 'expo-router';

import { Banner, ErrorState, LoadingState, PageHeader, Screen } from '@/components/ui';
import { fetchCrews, fetchStores } from '@/features/jobs/api';
import { JobForm } from '@/features/jobs/job-form';
import { useCompany } from '@/features/session';
import { useAsync } from '@/hooks/use-async';
import { isIsoDate } from '@/lib/dates';

export default function NewJobRoute() {
  const params = useLocalSearchParams<{ start?: string; end?: string; store?: string }>();
  const { companyId, isAdmin, role } = useCompany();
  const data = useAsync(async () => {
    const [stores, crews] = await Promise.all([fetchStores(companyId), isAdmin ? fetchCrews(companyId) : Promise.resolve([])]);
    return { stores, crews };
  }, [companyId, isAdmin]);

  if (role === 'crew_member') {
    return (
      <Screen>
        <Banner tone="warning">Zgłoszenia montażu wysyłają sklepy partnerskie i administrator firmy.</Banner>
      </Screen>
    );
  }
  if (data.loading && !data.data) return <LoadingState />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? ''} onRetry={data.reload} />;
  if (data.data.stores.length === 0) {
    return (
      <Screen>
        <PageHeader title={isAdmin ? 'Nowe zlecenie' : 'Zgłoś montaż'} />
        <Banner tone="warning" title="Brak sklepu">
          {isAdmin ? 'Najpierw dodaj sklep partnerski w zakładce „Sklepy partnerskie”.' : 'Twoje konto nie jest przypisane do aktywnego sklepu. Skontaktuj się z firmą montażową.'}
        </Banner>
      </Screen>
    );
  }
  const start = isIsoDate(params.start) ? params.start : undefined;
  const end = isIsoDate(params.end) ? params.end : start;
  return (
    <Screen maxWidth={860}>
      <PageHeader
        title={isAdmin ? 'Nowe zlecenie' : 'Zgłoś montaż'}
        subtitle={isAdmin ? 'Utwórz zlecenie w imieniu sklepu partnerskiego.' : 'Zgłoszenie trafi do firmy montażowej do akceptacji.'}
      />
      <JobForm stores={data.data.stores} crews={data.data.crews} preset={{ start, end, storeId: params.store }} />
    </Screen>
  );
}
