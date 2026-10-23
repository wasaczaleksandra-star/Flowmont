#!/usr/bin/env bash
# Builds a Supabase-like database (real GoTrue auth schema) for local end-to-end testing.
set -euo pipefail
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
DB=flowmont_e2e
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'pw'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole password 'pw'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
grant create on database flowmont_e2e to supabase_auth_admin;
create schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
SQL
