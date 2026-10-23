import { Stack } from 'expo-router';

import { LoadingState } from '@/components/ui';
import { useSession } from '@/features/session';
import { usePendingRedirect } from '@/hooks/use-pending-redirect';
import { AppShell } from '@/features/shell';
import { colors } from '@/theme/tokens';

export default function AppLayout() {
  const { active } = useSession();
  usePendingRedirect(!!active);
  // While the signed-in user's companies are loading, the root guard keeps this group mounted
  // (avoids redirect flicker); render nothing company-specific until the data is there.
  if (!active) return <LoadingState label="Wczytywanie Flowmont…" />;
  return (
    <AppShell>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'none' }} />
    </AppShell>
  );
}
