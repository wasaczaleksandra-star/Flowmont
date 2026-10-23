import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { AppText, Banner, Button, Card, KeyValue, LoadingState, PageHeader, Pill, Row, Screen, SectionTitle } from '@/components/ui';
import { AdminOnly } from '@/features/guards';
import { useCompany } from '@/features/session';
import { useAsync, unwrap } from '@/hooks/use-async';
import { formatTimestamp } from '@/lib/dates';
import { env } from '@/lib/env';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { SubscriptionStatus } from '@/lib/types';
import { space } from '@/theme/tokens';

const SUB_LABEL: Record<SubscriptionStatus, string> = {
  trialing: 'Okres próbny',
  active: 'Aktywna',
  past_due: 'Zaległa płatność',
  cancelled: 'Anulowana',
  expired: 'Wygasła',
};

const ACCESS_TEXT: Record<string, string> = {
  full: 'Pełny dostęp',
  read_only: 'Tylko do odczytu',
  suspended: 'Zawieszony',
};

type Access = { access_level: string; trial_started_at: string; trial_ends_at: string; subscription_status: SubscriptionStatus; current_period_end: string | null; plan_id: string | null };
type Plan = { id: string; name: string; price_label: string | null; provider_price_id: string | null };

function Billing() {
  const { companyId } = useCompany();
  const params = useLocalSearchParams<{ status?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = useAsync(async () => {
    const [access, plans] = await Promise.all([
      unwrap(supabase.rpc('company_access', { p_company_id: companyId })),
      unwrap(supabase.from('billing_plans').select('id, name, price_label, provider_price_id').eq('active', true).order('sort')),
    ]);
    return { access: (access as Access[])[0], plans: plans as Plan[] };
  }, [companyId]);

  async function openUrl(fn: 'billing-checkout' | 'billing-portal', body: object) {
    setError(null);
    setBusy(fn);
    const { data: res, error } = await supabase.functions.invoke(fn, { body });
    setBusy(null);
    if (error || !res?.url) {
      let msg = 'Płatności online nie są jeszcze skonfigurowane. Skontaktuj się z obsługą Flowmont.';
      try {
        const ctx = await (error as any)?.context?.json?.();
        if (ctx?.error) msg = ctx.error;
      } catch {}
      return setError(error ? msg : toUserMessage(res));
    }
    if (Platform.OS === 'web') window.location.assign(res.url);
    else Linking.openURL(res.url);
  }

  if (data.loading && !data.data) return <LoadingState />;
  const a = data.data?.access;
  const plans = data.data?.plans ?? [];
  const configured = env.billingEnabled && plans.some((p) => p.provider_price_id);

  return (
    <Screen maxWidth={860}>
      <PageHeader title="Subskrypcja" />
      {params.status === 'success' ? <Banner tone="success">Dziękujemy! Płatność została przyjęta. Status subskrypcji odświeży się po potwierdzeniu przez operatora płatności.</Banner> : null}
      {params.status === 'cancelled' ? <Banner tone="info">Płatność została przerwana. Możesz spróbować ponownie w dowolnym momencie.</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {a ? (
        <Card>
          <SectionTitle right={<Pill text={ACCESS_TEXT[a.access_level] ?? a.access_level} tone={a.access_level === 'full' ? 'success' : 'warning'} />}>Status konta</SectionTitle>
          <Row wrap gap={space.xl}>
            <KeyValue label="Subskrypcja" value={SUB_LABEL[a.subscription_status]} />
            <KeyValue label="Początek okresu próbnego" value={formatTimestamp(a.trial_started_at)} />
            <KeyValue label="Koniec okresu próbnego" value={formatTimestamp(a.trial_ends_at)} />
            {a.current_period_end ? <KeyValue label="Opłacone do" value={formatTimestamp(a.current_period_end)} /> : null}
          </Row>
          {a.access_level === 'read_only' ? (
            <Banner tone="warning">Twoje dane są bezpieczne i dostępne do odczytu. Aby znów przyjmować zgłoszenia i planować montaże, wykup subskrypcję.</Banner>
          ) : null}
          {a.subscription_status === 'past_due' ? <Banner tone="warning">Ostatnia płatność nie powiodła się. Zaktualizuj metodę płatności, aby uniknąć ograniczenia dostępu.</Banner> : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Plany</SectionTitle>
        {!configured ? (
          <Banner tone="info" title="Płatności online nie są jeszcze skonfigurowane">
            Plany i ceny ustala operator platformy. Do czasu uruchomienia płatności online skontaktuj się z obsługą Flowmont, aby przedłużyć dostęp.
          </Banner>
        ) : (
          <View style={{ gap: space.md }}>
            {plans
              .filter((p) => p.provider_price_id)
              .map((p) => (
                <Row key={p.id} wrap style={{ justifyContent: 'space-between' }}>
                  <View>
                    <AppText variant="subheading">{p.name}</AppText>
                    {p.price_label ? <AppText variant="muted">{p.price_label}</AppText> : null}
                  </View>
                  {a?.plan_id === p.id && a?.subscription_status === 'active' ? (
                    <Pill text="Twój plan" tone="success" />
                  ) : (
                    <Button title="Wybierz plan" onPress={() => openUrl('billing-checkout', { company_id: companyId, plan_id: p.id })} loading={busy === 'billing-checkout'} />
                  )}
                </Row>
              ))}
            {a && a.subscription_status !== 'trialing' && a.subscription_status !== 'expired' ? (
              <Button title="Zarządzaj płatnościami i fakturami" variant="secondary" icon="open-outline" onPress={() => openUrl('billing-portal', { company_id: companyId })} loading={busy === 'billing-portal'} style={{ alignSelf: 'flex-start' }} />
            ) : null}
          </View>
        )}
      </Card>
    </Screen>
  );
}

export default function BillingRoute() {
  return (
    <AdminOnly>
      <Billing />
    </AdminOnly>
  );
}
