import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  Banner,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pill,
  Row,
  Screen,
  TextField,
  useToast,
} from '@/components/ui';
import { fetchStores } from '@/features/jobs/api';
import { AdminOnly } from '@/features/guards';
import { InviteDialog } from '@/features/admin/invite-dialog';
import { useCompany } from '@/features/session';
import { useAsync } from '@/hooks/use-async';
import { toUserMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Store } from '@/lib/types';
import { space } from '@/theme/tokens';

type Form = {
  name: string;
  nip: string;
  email: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  contact_person: string;
  notes: string;
  notify_email: boolean;
  notify_sms: boolean;
};

const empty: Form = { name: '', nip: '', email: '', phone: '', street: '', postal_code: '', city: '', contact_person: '', notes: '', notify_email: true, notify_sms: false };

function StoreDialog({ store, visible, onClose, onSaved }: { store: Store | null; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const { companyId } = useCompany();
  const toast = useToast();
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  if (visible && loadedFor !== (store?.id ?? null)) {
    setLoadedFor(store?.id ?? null);
    setF(
      store
        ? {
            name: store.name,
            nip: store.nip ?? '',
            email: store.email ?? '',
            phone: store.phone ?? '',
            street: store.street ?? '',
            postal_code: store.postal_code ?? '',
            city: store.city ?? '',
            contact_person: store.contact_person ?? '',
            notes: store.notes ?? '',
            notify_email: store.notify_email,
            notify_sms: store.notify_sms,
          }
        : empty,
    );
    setErrors({});
    setError(null);
  }
  if (!visible && loadedFor !== undefined) setLoadedFor(undefined);

  const set = (k: keyof Form) => (v: any) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Podaj nazwę sklepu.';
    if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Podaj poprawny adres e-mail.';
    if (f.postal_code.trim() && !/^\d{2}-?\d{3}$/.test(f.postal_code.trim())) e.postal_code = 'Format 00-000.';
    if (f.nip.trim() && f.nip.replace(/\D/g, '').length !== 10) e.nip = 'NIP musi mieć 10 cyfr.';
    if (f.notify_sms && !f.phone.trim()) e.phone = 'Podaj telefon, aby wysyłać SMS.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    const pc = f.postal_code.trim().replace(/^(\d{2})(\d{3})$/, '$1-$2');
    const payload = {
      name: f.name.trim(),
      nip: f.nip.trim() || null,
      email: f.email.trim().toLowerCase() || null,
      phone: f.phone.trim() || null,
      street: f.street.trim() || null,
      postal_code: pc || null,
      city: f.city.trim() || null,
      contact_person: f.contact_person.trim() || null,
      notes: f.notes.trim() || null,
      notify_email: f.notify_email,
      notify_sms: f.notify_sms,
    };
    const res = store
      ? await supabase.from('stores').update(payload).eq('id', store.id)
      : await supabase.from('stores').insert({ ...payload, company_id: companyId });
    setBusy(false);
    if (res.error) {
      return setError(res.error.code === '23505' ? 'Sklep o tej nazwie już istnieje.' : toUserMessage(res.error));
    }
    toast(store ? 'Zapisano zmiany sklepu.' : 'Dodano sklep partnerski.');
    onSaved();
    onClose();
  }

  return (
    <Dialog
      visible={visible}
      title={store ? `Edytuj: ${store.name}` : 'Nowy sklep partnerski'}
      onClose={onClose}
      footer={
        <>
          <Button title="Anuluj" variant="secondary" onPress={onClose} />
          <Button title="Zapisz" onPress={save} loading={busy} />
        </>
      }>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <TextField label="Nazwa sklepu" required value={f.name} onChangeText={set('name')} error={errors.name} />
      <TextField label="Osoba kontaktowa" value={f.contact_person} onChangeText={set('contact_person')} />
      <TextField label="E-mail do powiadomień" value={f.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <TextField label="Telefon" value={f.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" />
      <TextField label="NIP" value={f.nip} onChangeText={set('nip')} error={errors.nip} keyboardType="number-pad" />
      <TextField label="Ulica i numer" value={f.street} onChangeText={set('street')} />
      <Row wrap>
        <View style={{ flexBasis: 120, flexShrink: 1, flexGrow: 1 }}>
          <TextField label="Kod pocztowy" value={f.postal_code} onChangeText={set('postal_code')} error={errors.postal_code} />
        </View>
        <View style={{ flexBasis: 200, flexShrink: 1, flexGrow: 2 }}>
          <TextField label="Miejscowość" value={f.city} onChangeText={set('city')} />
        </View>
      </Row>
      <TextField label="Notatki (widoczne tylko dla firmy)" value={f.notes} onChangeText={set('notes')} multiline />
      <Checkbox label="Wysyłaj powiadomienia e-mail na adres sklepu" value={f.notify_email} onChange={set('notify_email')} />
      <Checkbox label="Wysyłaj powiadomienia SMS na telefon sklepu" value={f.notify_sms} onChange={set('notify_sms')} />
    </Dialog>
  );
}

function Stores() {
  const { companyId, canWrite } = useCompany();
  const toast = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [open, setOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<Store | null>(null);
  const stores = useAsync(() => fetchStores(companyId, true), [companyId]);
  const rows = (stores.data ?? []).filter((s) => showInactive || s.active);

  async function toggleActive(s: Store) {
    const { error } = await supabase.from('stores').update({ active: !s.active }).eq('id', s.id);
    if (error) return toast(toUserMessage(error), 'error');
    toast(s.active ? 'Sklep dezaktywowany. Historia zleceń została zachowana.' : 'Sklep aktywowany.');
    stores.reload();
  }

  return (
    <Screen>
      <PageHeader
        title="Sklepy partnerskie"
        subtitle="Sklepy zgłaszające montaże. Dezaktywacja blokuje nowe zgłoszenia, ale zachowuje historię."
        actions={
          canWrite ? (
            <Row wrap>
              <Button title="Import z Excela" variant="secondary" icon="cloud-upload-outline" onPress={() => router.push('/import')} />
              <Button title="Dodaj sklep" icon="add" onPress={() => { setEditing(null); setOpen(true); }} />
            </Row>
          ) : null
        }
      />
      <Checkbox label="Pokaż nieaktywne sklepy" value={showInactive} onChange={setShowInactive} />
      {stores.loading && !stores.data ? <LoadingState /> : null}
      {stores.error ? <ErrorState message={stores.error} onRetry={stores.reload} /> : null}
      {stores.data && rows.length === 0 ? <EmptyState title="Brak sklepów" icon="storefront-outline">Dodaj pierwszy sklep partnerski lub zaimportuj listę z Excela.</EmptyState> : null}
      <View style={{ gap: space.sm }}>
        {rows.map((s) => (
          <Card key={s.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
              <Row wrap>
                <AppText variant="subheading">{s.name}</AppText>
                {!s.active ? <Pill text="Nieaktywny" /> : null}
              </Row>
              <AppText variant="muted">{[s.city, s.email, s.phone].filter(Boolean).join(' · ') || 'Brak danych kontaktowych'}</AppText>
            </View>
            {canWrite ? (
              <Row wrap>
                {s.active ? <Button title="Zaproś użytkownika" variant="secondary" compact icon="person-add-outline" onPress={() => setInviteFor(s)} /> : null}
                <Button title="Edytuj" variant="secondary" compact onPress={() => { setEditing(s); setOpen(true); }} />
                <Button title={s.active ? 'Dezaktywuj' : 'Aktywuj'} variant={s.active ? 'danger' : 'secondary'} compact onPress={() => toggleActive(s)} />
              </Row>
            ) : null}
          </Card>
        ))}
      </View>
      <StoreDialog store={editing} visible={open} onClose={() => setOpen(false)} onSaved={stores.reload} />
      <InviteDialog visible={!!inviteFor} onClose={() => setInviteFor(null)} presetRole="store_user" presetStoreId={inviteFor?.id} presetEmail={inviteFor?.email ?? ''} />
    </Screen>
  );
}

export default function StoresRoute() {
  return (
    <AdminOnly>
      <Stores />
    </AdminOnly>
  );
}
