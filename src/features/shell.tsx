import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Banner, Button, IconButton, type IconName } from '@/components/ui';
import { useLayout } from '@/hooks/use-layout';
import { formatTimestamp } from '@/lib/dates';
import { ROLE_LABEL, type Role } from '@/lib/status';
import { colors, font, radius, space } from '@/theme/tokens';
import { useCompany, useSession } from './session';

type NavItem = { href: Href; label: string; icon: IconName; match?: string };

export function navFor(role: Role, isPlatformOwner: boolean): { main: NavItem[]; mobile: NavItem[] } {
  let main: NavItem[];
  let mobile: NavItem[];
  if (role === 'admin') {
    main = [
      { href: '/', label: 'Pulpit', icon: 'grid-outline', match: '/' },
      { href: '/calendar', label: 'Kalendarz', icon: 'calendar-outline' },
      { href: '/requests', label: 'Zgłoszenia', icon: 'mail-unread-outline' },
      { href: '/jobs', label: 'Zlecenia', icon: 'construct-outline' },
      { href: '/plan', label: 'Plan dnia', icon: 'today-outline' },
      { href: '/stores', label: 'Sklepy partnerskie', icon: 'storefront-outline' },
      { href: '/users', label: 'Użytkownicy', icon: 'people-outline' },
      { href: '/crews', label: 'Ekipy', icon: 'hammer-outline' },
      { href: '/availability', label: 'Dostępność', icon: 'ban-outline' },
      { href: '/announcements', label: 'Ogłoszenia', icon: 'megaphone-outline' },
      { href: '/notifications', label: 'Powiadomienia', icon: 'notifications-outline' },
      { href: '/import', label: 'Import z Excela', icon: 'cloud-upload-outline' },
      { href: '/settings', label: 'Ustawienia firmy', icon: 'settings-outline' },
      { href: '/billing', label: 'Subskrypcja', icon: 'card-outline' },
    ];
    mobile = [main[0], main[1], main[2], main[4]];
  } else if (role === 'store_user') {
    main = [
      { href: '/calendar', label: 'Kalendarz', icon: 'calendar-outline' },
      { href: '/jobs/new', label: 'Zgłoś montaż', icon: 'add-circle-outline' },
      { href: '/jobs', label: 'Moje zlecenia', icon: 'construct-outline' },
    ];
    mobile = main;
  } else {
    main = [
      { href: '/plan', label: 'Plan dnia', icon: 'today-outline' },
      { href: '/calendar', label: 'Kalendarz', icon: 'calendar-outline' },
      { href: '/jobs', label: 'Moje zlecenia', icon: 'construct-outline' },
    ];
    mobile = main;
  }
  main = [...main, { href: '/account', label: 'Moje konto', icon: 'person-circle-outline' }];
  if (isPlatformOwner) main.push({ href: '/platform', label: 'Platforma', icon: 'shield-checkmark-outline' });
  return { main, mobile };
}

function isActive(pathname: string, item: NavItem): boolean {
  const href = String(item.href);
  if (item.match === '/') return pathname === '/';
  if (href === '/jobs') return pathname === '/jobs' || (pathname.startsWith('/jobs/') && pathname !== '/jobs/new');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      aria-current={active ? 'page' : undefined}
      onPress={() => {
        onNavigate?.();
        router.navigate(item.href);
      }}
      style={(s) => [
        styles.navLink,
        active && styles.navLinkActive,
        (s as any).hovered && !active && { backgroundColor: 'rgba(255,255,255,0.08)' },
        (s as any).focused && styles.focusLight,
      ]}>
      <Ionicons name={item.icon} size={20} color={active ? colors.primary : '#D6E6F5'} />
      <Text style={[styles.navText, active && { color: colors.primary }]} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  );
}

function CompanyBadge({ onPress }: { onPress?: () => void }) {
  const { name, role } = useCompany();
  const { companies } = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Firma: ${name}. ${companies.length > 1 ? 'Zmień firmę' : ''}`}
      onPress={onPress}
      disabled={!onPress}
      style={styles.companyBadge}>
      <View style={{ flex: 1 }}>
        <Text style={styles.companyName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.companyRole}>{ROLE_LABEL[role]}</Text>
      </View>
      {companies.length > 1 ? <Ionicons name="swap-horizontal" size={18} color="#D6E6F5" /> : null}
    </Pressable>
  );
}

function Brand() {
  return (
    <View style={styles.brand} accessibilityRole="header">
      <View style={styles.logo}>
        <View style={styles.logoBar} />
        <View style={styles.logoDot} />
      </View>
      <Text style={styles.brandText}>Flowmont</Text>
    </View>
  );
}

function AccessBanner() {
  const { access, isAdmin, company } = useCompany();
  if (company.is_demo) {
    return (
      <View style={styles.bannerWrap}>
        <Banner tone="info" title="Środowisko demonstracyjne">
          Wszystkie dane w tej firmie są fikcyjne. Wiadomości nie są wysyłane do prawdziwych odbiorców.
        </Banner>
      </View>
    );
  }
  if (access === 'read_only') {
    return (
      <View style={styles.bannerWrap}>
        <Banner
          tone="warning"
          title="Tryb tylko do odczytu"
          action={isAdmin ? <Button compact title="Subskrypcja" onPress={() => router.push('/billing')} /> : undefined}>
          {isAdmin
            ? `Okres próbny zakończył się ${formatTimestamp(company.trial_ends_at)}. Dane są bezpieczne – wykup subskrypcję, aby znów przyjmować zlecenia.`
            : 'Konto firmy montażowej jest obecnie w trybie tylko do odczytu. Nowe zgłoszenia będą możliwe po wznowieniu subskrypcji przez firmę.'}
        </Banner>
      </View>
    );
  }
  if (access === 'suspended') {
    return (
      <View style={styles.bannerWrap}>
        <Banner tone="danger" title="Dostęp zawieszony">
          Dostęp do konta firmy został zawieszony. Skontaktuj się z obsługą Flowmont.
        </Banner>
      </View>
    );
  }
  return null;
}

function CompanySwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { companies, active, setActiveCompany } = useSession();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.switcherBackdrop} onPress={onClose} accessibilityLabel="Zamknij">
        <View style={styles.switcher}>
          <AppText variant="subheading">Wybierz firmę</AppText>
          {companies.map((c) => (
            <Pressable
              key={c.company_id}
              accessibilityRole="button"
              onPress={() => {
                setActiveCompany(c.company_id);
                onClose();
                router.replace('/');
              }}
              style={[styles.switcherItem, c.company_id === active?.company_id && { backgroundColor: colors.infoBg }]}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: '600' }}>{c.name}</AppText>
                <AppText variant="small">
                  {ROLE_LABEL[c.role]}
                  {c.is_demo ? ' · demo' : ''}
                </AppText>
              </View>
              {c.company_id === active?.company_id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { isWide } = useLayout();
  const pathname = usePathname();
  const { role } = useCompany();
  const { isPlatformOwner, companies } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const nav = navFor(role, isPlatformOwner);
  const openSwitcher = companies.length > 1 ? () => setSwitcherOpen(true) : undefined;

  if (isWide) {
    return (
      <View style={styles.wideRoot}>
        <View style={styles.sidebar} role="navigation" aria-label="Menu główne">
          <Brand />
          <CompanyBadge onPress={openSwitcher} />
          <ScrollView contentContainerStyle={{ gap: 2, paddingBottom: space.lg }}>
            {nav.main.map((item) => (
              <NavLink key={String(item.href)} item={item} active={isActive(pathname, item)} />
            ))}
          </ScrollView>
        </View>
        <View style={styles.content} role="main">
          <AccessBanner />
          {children}
        </View>
        <CompanySwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      </View>
    );
  }

  return (
    <View style={styles.narrowRoot}>
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarInner}>
          <Brand />
          <View style={{ flex: 1 }} />
          <IconButton icon="menu" label="Otwórz menu" color="#FFFFFF" onPress={() => setMenuOpen(true)} />
        </View>
      </SafeAreaView>
      <View style={{ flex: 1 }} role="main">
        <AccessBanner />
        {children}
      </View>
      <SafeAreaView edges={['bottom']} style={styles.bottomBar} role="navigation" aria-label="Szybka nawigacja">
        <View style={styles.bottomInner}>
          {nav.mobile.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Pressable
                key={String(item.href)}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => router.navigate(item.href)}
                style={styles.bottomItem}>
                <Ionicons name={item.icon.replace('-outline', '') as IconName} size={22} color={active ? colors.primary : colors.textMuted} />
                <Text style={[styles.bottomText, active && { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="Więcej" onPress={() => setMenuOpen(true)} style={styles.bottomItem}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
            <Text style={styles.bottomText}>Więcej</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal visible={menuOpen} animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <SafeAreaView style={styles.mobileMenu}>
          <View style={styles.topBarInner}>
            <Brand />
            <View style={{ flex: 1 }} />
            <IconButton icon="close" label="Zamknij menu" color="#FFFFFF" onPress={() => setMenuOpen(false)} />
          </View>
          <CompanyBadge
            onPress={
              openSwitcher
                ? () => {
                    setMenuOpen(false);
                    setSwitcherOpen(true);
                  }
                : undefined
            }
          />
          <ScrollView contentContainerStyle={{ gap: 2, padding: space.sm }}>
            {nav.main.map((item) => (
              <NavLink key={String(item.href)} item={item} active={isActive(pathname, item)} onNavigate={() => setMenuOpen(false)} />
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <CompanySwitcher visible={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wideRoot: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  sidebar: { width: 248, backgroundColor: colors.primary, paddingHorizontal: space.md, paddingTop: space.lg, gap: space.md },
  content: { flex: 1, minWidth: 0 },
  narrowRoot: { flex: 1, backgroundColor: colors.bg },
  topBar: { backgroundColor: colors.primary },
  topBarInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, minHeight: 56 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  logo: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  logoBar: { position: 'absolute', left: 6, top: 12, width: 12, height: 4, backgroundColor: colors.accent },
  logoDot: { position: 'absolute', right: 5, bottom: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFA723' },
  brandText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3, fontFamily: font.family },
  companyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: Platform.OS === 'web' ? 0 : space.sm,
  },
  companyName: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, fontFamily: font.family },
  companyRole: { color: '#C7DBEE', fontSize: 12, fontFamily: font.family },
  navLink: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md },
  navLinkActive: { backgroundColor: '#FFFFFF' },
  navText: { color: '#EAF3FB', fontSize: 15, fontWeight: '500', flexShrink: 1, fontFamily: font.family },
  focusLight: Platform.select({ web: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: '#FFA723' } as object, default: {} }) as object,
  bannerWrap: { paddingHorizontal: space.lg, paddingTop: space.md, maxWidth: 1100, width: '100%', alignSelf: 'center' },
  bottomBar: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  bottomInner: { flexDirection: 'row' },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minHeight: 56, gap: 2 },
  bottomText: { fontSize: 11, color: colors.textMuted, fontFamily: font.family },
  mobileMenu: { flex: 1, backgroundColor: colors.primary, gap: space.md },
  switcherBackdrop: { flex: 1, backgroundColor: 'rgba(0,28,52,0.45)', justifyContent: 'center', alignItems: 'center', padding: space.lg },
  switcher: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, width: '100%', maxWidth: 420 },
  switcherItem: { flexDirection: 'row', alignItems: 'center', padding: space.md, borderRadius: radius.md, minHeight: 44 },
});
