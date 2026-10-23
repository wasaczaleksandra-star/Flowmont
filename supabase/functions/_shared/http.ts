// Deno-only helpers for Edge Functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() !== '' ? v : undefined;
}

/** Server-side client with the service role key. Never exposed to the browser. */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client acting as the calling user, so RLS and RPC permission checks apply. */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

/** Returns the company row when the caller is an active administrator of it. */
export async function requireCompanyAdmin(req: Request, companyId: string) {
  const client = userClient(req);
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return { error: json({ error: 'Zaloguj się ponownie.' }, 401) } as const;
  const { data, error } = await client.rpc('my_companies');
  const company = (data as any[] | null)?.find((c) => c.company_id === companyId);
  if (error || !company || company.role !== 'admin') {
    return { error: json({ error: 'Tylko administrator firmy może zarządzać subskrypcją.' }, 403) } as const;
  }
  return { company, user: userData.user } as const;
}
