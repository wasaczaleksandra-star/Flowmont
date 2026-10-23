import type { EmailOtpType } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AppText, Card, Screen } from '@/components/ui';
import { authRedirectUrl } from '@/lib/redirect';
import { supabase } from '@/lib/supabase';
import { colors, font, space } from '@/theme/tokens';

WebBrowser.maybeCompleteAuthSession();

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Screen maxWidth={460}>
      <View style={styles.wrap}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <View style={styles.logoBar} />
            <View style={styles.logoDot} />
          </View>
          <Text style={styles.brandText}>Flowmont</Text>
        </View>
        <Card style={{ gap: space.lg }}>
          <View style={{ gap: 4 }}>
            <AppText variant="heading" accessibilityRole="header">
              {title}
            </AppText>
            {subtitle ? <AppText variant="muted">{subtitle}</AppText> : null}
          </View>
          {children}
        </Card>
        <AppText variant="small" style={{ textAlign: 'center' }}>
          Flowmont – terminy montaży dla firm montażowych i sklepów partnerskich
        </AppText>
      </View>
    </Screen>
  );
}

export async function signInWithGoogle(next?: string) {
  const redirectTo = authRedirectUrl(`/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw error;
    return;
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return;
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new Error('Logowanie Google zostało przerwane.');
  const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exErr) throw exErr;
}

/**
 * Completes an auth link. Supports PKCE (?code=…, same browser) and token-hash links
 * (?token_hash=…&type=…, works in any browser – recommended e-mail template, see docs/AUTH.md).
 */
export async function completeAuthFromParams(params: Record<string, string | string[] | undefined>) {
  const get = (k: string) => (Array.isArray(params[k]) ? params[k]?.[0] : params[k]) as string | undefined;
  const errorDescription = get('error_description');
  if (errorDescription) {
    throw new Error(
      /expired/i.test(errorDescription)
        ? 'Link wygasł. Poproś o nowy i użyj go w ciągu godziny.'
        : 'Link jest nieprawidłowy lub został już użyty.',
    );
  }
  const tokenHash = get('token_hash');
  const type = get('type') as EmailOtpType | undefined;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new Error('Link wygasł lub został już użyty. Poproś o nowy.');
    return;
  }
  const code = get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      throw new Error(
        'Nie udało się potwierdzić logowania. Otwórz link w tej samej przeglądarce, w której o niego poproszono, albo zaloguj się hasłem.',
      );
    }
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Brak danych logowania w linku. Zaloguj się ponownie.');
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg, paddingVertical: space.xl },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.primary, overflow: 'hidden' },
  logoBar: { position: 'absolute', left: 7, top: 15, width: 15, height: 5, backgroundColor: colors.accent },
  logoDot: { position: 'absolute', right: 6, bottom: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFA723' },
  brandText: { color: colors.primary, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, fontFamily: font.family },
});
