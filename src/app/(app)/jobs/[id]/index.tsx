import { useLocalSearchParams } from 'expo-router';

import { JobDetailScreen } from '@/features/jobs/job-detail';

export default function JobDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <JobDetailScreen id={id} />;
}
