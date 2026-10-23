import { useLocalSearchParams } from 'expo-router';

import { Banner, ErrorState, LoadingState, PageHeader, Screen } from '@/components/ui';
import { fetchCrews, fetchJob, fetchJobDetails, fetchStores } from '@/features/jobs/api';
import { JobForm } from '@/features/jobs/job-form';
import { useCompany } from '@/features/session';
import { useAsync } from '@/hooks/use-async';

export default function EditJobRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { companyId, isAdmin } = useCompany();
  const data = useAsync(async () => {
    const [job, details, stores, crews] = await Promise.all([
      fetchJob(id),
      fetchJobDetails(id),
      fetchStores(companyId, true),
      isAdmin ? fetchCrews(companyId) : Promise.resolve([]),
    ]);
    return { job, details, stores, crews };
  }, [id, companyId, isAdmin]);

  if (data.loading && !data.data) return <LoadingState />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? 'Nie znaleziono zlecenia.'} onRetry={data.reload} />;
  const { job, details, stores, crews } = data.data;
  if (!job) {
    return (
      <Screen>
        <Banner tone="warning">Nie znaleziono zlecenia albo nie masz do niego dostępu.</Banner>
      </Screen>
    );
  }
  return (
    <Screen maxWidth={860}>
      <PageHeader title={`Edycja ${job.reference}`} subtitle="Zmiany zostaną zapisane w historii zlecenia." />
      <JobForm stores={stores} crews={crews} job={job} existingMeasurements={details.measurements} />
    </Screen>
  );
}
