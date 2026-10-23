import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { sessionStorage } from '@/lib/session-storage';
import { supabase } from '@/lib/supabase';
import type { AccessLevel, MyCompany } from '@/lib/types';
import type { Role } from '@/lib/status';

type SessionState = {
  /** true until the stored session and the user's companies are loaded */
  loading: boolean;
  /** true once the stored session has been read */
  authReady: boolean;
  session: Session | null;
  user: User | null;
  companies: MyCompany[];
  companiesError: string | null;
  active: MyCompany | null;
  setActiveCompany: (id: string) => void;
  reloadCompanies: () => Promise<MyCompany[]>;
  signOut: () => Promise<void>;
  isPlatformOwner: boolean;
};

const SessionContext = createContext<SessionState | null>(null);

const activeKey = (userId: string) => `flowmont.activeCompany.${userId}`;

async function fetchCompanies(userId: string) {
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc('my_companies'),
    supabase.from('profiles').select('is_platform_owner').eq('id', userId).maybeSingle(),
  ]);
  return {
    list: (data ?? []) as MyCompany[],
    isPlatformOwner: Boolean(profile.data?.is_platform_owner),
    error: error ? 'Nie udało się wczytać listy firm. Sprawdź połączenie i odśwież stronę.' : null,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [companiesFor, setCompaniesFor] = useState<string | null>(null);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const applyCompanies = useCallback((forUser: string, r: Awaited<ReturnType<typeof fetchCompanies>>) => {
    setCompaniesError(r.error);
    setCompanies(r.list);
    setIsPlatformOwner(r.isPlatformOwner);
    const stored = sessionStorage.getItem(activeKey(forUser));
    const pick = r.list.find((c) => c.company_id === stored) ?? r.list[0] ?? null;
    setActiveId(pick?.company_id ?? null);
    setCompaniesFor(forUser);
  }, []);

  const reloadCompanies = useCallback(async () => {
    if (!userId) return [];
    const r = await fetchCompanies(userId);
    applyCompanies(userId, r);
    return r.list;
  }, [userId, applyCompanies]);

  // Whenever the signed-in account changes (including switching to a second account), the
  // previous user's companies are hidden immediately (companiesFor no longer matches) and the
  // new user's companies are loaded. A late response for a previous account is ignored.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchCompanies(userId).then((r) => {
      if (!cancelled) applyCompanies(userId, r);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, applyCompanies]);

  const setActiveCompany = useCallback(
    (id: string) => {
      if (!userId) return;
      sessionStorage.setItem(activeKey(userId), id);
      setActiveId(id);
    },
    [userId],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const loading = !authReady || (userId !== null && companiesFor !== userId);
  const current = userId !== null && companiesFor === userId;
  const visibleCompanies = useMemo(() => (current ? companies : []), [current, companies]);
  const active = visibleCompanies.find((c) => c.company_id === activeId) ?? null;

  const value = useMemo<SessionState>(
    () => ({
      loading,
      authReady,
      session,
      user,
      companies: visibleCompanies,
      companiesError: current ? companiesError : null,
      active,
      setActiveCompany,
      reloadCompanies,
      signOut,
      isPlatformOwner: current && isPlatformOwner,
    }),
    [loading, authReady, session, user, visibleCompanies, current, companiesError, active, setActiveCompany, reloadCompanies, signOut, isPlatformOwner],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

/** Active company context for screens inside the app (always present there). */
export function useCompany(): {
  companyId: string;
  name: string;
  role: Role;
  access: AccessLevel;
  canWrite: boolean;
  isAdmin: boolean;
  storeIds: string[];
  crewIds: string[];
  company: MyCompany;
} {
  const { active } = useSession();
  if (!active) throw new Error('No active company');
  return {
    companyId: active.company_id,
    name: active.name,
    role: active.role,
    access: active.access_level,
    canWrite: active.access_level === 'full',
    isAdmin: active.role === 'admin',
    storeIds: active.store_ids ?? [],
    crewIds: active.crew_ids ?? [],
    company: active,
  };
}
