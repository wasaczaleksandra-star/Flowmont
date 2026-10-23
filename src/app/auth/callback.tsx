import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Banner, Button, LoadingState } from '@/components/ui';
import { AuthLayout, completeAuthFromParams } from '@/features/auth';
import { setPendingNext } from '@/lib/pending';
import { safeNextPath } from '@/lib/redirect';

export default function AuthCallback() {
  const params = useLocalSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const next = safeNextPath(params.next);
    completeAuthFromParams(params as any)
      .then(() => {
        if (next !== '/') setPendingNext(next);
        router.replace('/');
      })
      .catch((e: Error) => setError(e.message));
  }, [params]);

  return (
    <AuthLayout title={error ? 'Nie udało się zalogować' : 'Logowanie…'}>
      {error ? (
        <>
          <Banner tone="danger">{error}</Banner>
          <Button title="Przejdź do logowania" onPress={() => router.replace('/sign-in')} />
        </>
      ) : (
        <LoadingState label="Potwierdzamy logowanie…" />
      )}
    </AuthLayout>
  );
}
