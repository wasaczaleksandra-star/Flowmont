import { router } from 'expo-router';
import { useEffect } from 'react';

import { takePendingNext } from '@/lib/pending';

/**
 * Opens the page the user originally came for (e.g. an invitation link) once they land on a
 * signed-in screen. Runs after route guards have settled, so it is not overridden by them.
 */
export function usePendingRedirect(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const next = takePendingNext();
    if (next && next !== '/') router.replace(next as never);
  }, [enabled]);
}
