import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env } from './env';
import { sessionStorage } from './session-storage';

export const supabase = createClient(env.supabaseUrl || 'http://localhost:54321', env.supabaseKey || 'missing-key', {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Auth links are handled explicitly by /auth/callback and /auth/reset on every platform.
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
