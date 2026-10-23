// Public configuration (safe to ship in the app bundle). Never put secret keys here.
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  /** Set to "true" only after the Google provider is configured in Supabase. */
  googleAuthEnabled: process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED === 'true',
  /** Set to "true" when billing Edge Functions and plans are configured. */
  billingEnabled: process.env.EXPO_PUBLIC_BILLING_ENABLED === 'true',
};

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
