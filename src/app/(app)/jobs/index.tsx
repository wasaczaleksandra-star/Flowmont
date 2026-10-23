import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, ChoiceChips, EmptyState, ErrorState, LoadingState, PageHeader, Screen, SelectField, TextField } from '@/components/ui';
import { fetchStores, JOB_SELECT } from '@/features/jobs/api';
import { JobRow } from '@/features/jobs/job-detail';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { todayWarsaw } from '@/lib/dates';
import { ALL_STATUSES, STATUS_LABEL, type JobStatus } from '@/lib/status';
import { supabase } from '@/lib/supabase';
import type { Job } from '@/lib/types';
import { space } from '@/theme/tokens';

type Scope = 'upcoming' | 'past' | 'all';

export default function JobsList() {
  const { companyId, isAdmin, role, canWrite } = useCompany();
  const [status, setStatus] = useState<JobStatus | 'any'>('any');
  const [scope, setScope] = useState<Scope>('upcoming');
  const [storeId, setStoreId] = useState<string>('any');
  const [search, setSearch] = useState('');
  const today = todayWarsaw();

  const stores = useAsync(() => fetchStores(companyId, true), [companyId], isAdmin);
  const jobs = useAsync(async () => {
    let q = supabase.from('jobs').select(JOB_SELECT).eq('company_id', companyId).limit(500);
    if (status !== 'any') q = q.eq('status', status);
    if (storeId !== 'any') q = q.eq('store_id', storeId);
    if (scope === 'upcoming') q = q.or(`requested_end.gte.${today},confirmed_end.gte.${today}`).order('requested_start', { ascending: true });
    else if (scope === 'past') q = q.lt('requested_end', today).or(`confirmed_end.is.null,confirmed_end.lt.${today}`).order('requested_start', { ascending: false });
    else q = q.order('created_at', { ascending: false });
    return (await unwrap(q)) as Job[];
  }, [companyId, status, scope, storeId, today]);

  const term = search.trim().toLowerCase();
  const rows = (jobs.data ?? []).filter(
    (j) => !term || [j.reference, j.customer_name, j.city, j.street, j.stores?.name ?? ''].some((v) => v.toLowerCase().includes(term)),
  );

  return (
    <Screen>
      <PageHeader
        title={role === 'admin' ? 'Zlecenia' : 'Moje zlecenia'}
        subtitle={role === 'crew_member' ? 'Zlecenia przypisane do Twojej ekipy.' : undefined}
        actions={role !== 'crew_member' && canWrite ? <Button title={isAdmin ? 'Nowe zlecenie' : 'Zgłoś montaż'} icon="add" onPress={() => router.push('/jobs/new')} /> : null}
      />
      <View style={{ gap: space.md }}>
        <TextField label="Szukaj" value={search} onChangeText={setSearch} placeholder="Numer, klient, miejscowość, sklep" />
        <ChoiceChips<Scope>
          label="Zakres"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'upcoming', label: 'Bieżące i przyszłe' },
            { value: 'past', label: 'Zakończone terminy' },
            { value: 'all', label: 'Wszystkie' },
          ]}
        />
        <ChoiceChips<JobStatus | 'any'>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'any', label: 'Wszystkie' }, ...ALL_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
        />
        {isAdmin ? (
          <SelectField
            label="Sklep"
            value={storeId}
            onChange={setStoreId}
            options={[{ value: 'any', label: 'Wszystkie sklepy' }, ...(stores.data ?? []).map((s) => ({ value: s.id, label: s.active ? s.name : `${s.name} (nieaktywny)` }))]}
          />
        ) : null}
      </View>
      {jobs.loading && !jobs.data ? <LoadingState /> : null}
      {jobs.error ? <ErrorState message={jobs.error} onRetry={jobs.reload} /> : null}
      {jobs.data && rows.length === 0 ? (
        <EmptyState title="Brak zleceń" icon="construct-outline">
          {term || status !== 'any' || storeId !== 'any' ? 'Zmień filtry, aby zobaczyć więcej zleceń.' : 'Nie ma jeszcze zleceń w tym zakresie.'}
        </EmptyState>
      ) : null}
      <View style={{ gap: space.sm }}>
        {rows.map((j) => (
          <JobRow key={j.id} job={j} showStore={role !== 'store_user'} />
        ))}
      </View>
    </Screen>
  );
}
