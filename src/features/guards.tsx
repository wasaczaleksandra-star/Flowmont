import type { ReactNode } from 'react';

import { Banner, Screen } from '@/components/ui';
import { useCompany } from './session';

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useCompany();
  if (!isAdmin) {
    return (
      <Screen>
        <Banner tone="warning" title="Brak dostępu">
          Ta sekcja jest dostępna tylko dla administratora firmy montażowej.
        </Banner>
      </Screen>
    );
  }
  return <>{children}</>;
}
