#!/usr/bin/env bash
# Starts a minimal Supabase-compatible stack WITHOUT Docker, for end-to-end tests only:
# PostgreSQL (must already run on 127.0.0.1:54329) + GoTrue (auth) + PostgREST + a small gateway
# on :54321 that also emulates Storage (authorised through the real storage.objects policies) and
# runs the real outbox processor with the mock adapters. Prefer `npx supabase start` when Docker works.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BIN="$HERE/.bin"
mkdir -p "$BIN" "$HERE/.logs"
export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres

if [ ! -x "$BIN/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-linux-static-x86-64.tar.xz | tar -xJ -C "$BIN"
fi
if [ ! -x "$BIN/auth" ]; then
  curl -sSL https://github.com/supabase/auth/releases/download/v2.177.0/auth-v2.177.0-x86.tar.gz | tar -xz -C "$BIN"
fi

bash "$HERE/init-db.sh"
(cd "$BIN" && set -a && . "$HERE/gotrue.env" && GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" && set +a && nohup ./auth > "$HERE/.logs/gotrue.log" 2>&1 &)
for i in $(seq 1 30); do curl -sf localhost:9999/health >/dev/null && break; sleep 1; done

psql -q -v ON_ERROR_STOP=1 -d flowmont_e2e <<'SQL'
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner_id text, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, service_role;
SQL
for f in "$ROOT"/supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d flowmont_e2e -f "$f"; done
psql -q -d flowmont_e2e -c "insert into public.app_settings values ('app_url','http://localhost:8081') on conflict do nothing"

(cd "$HERE" && node keys.mjs > keys.json)
(cd "$BIN" && nohup ./postgrest "$HERE/postgrest.conf" > "$HERE/.logs/postgrest.log" 2>&1 &)
(cd "$HERE" && nohup node gateway.mjs > "$HERE/.logs/gateway.log" 2>&1 &)
sleep 3
echo "Gateway: http://localhost:54321  anon key: $(node -p "require('$HERE/keys.json').anon")"
