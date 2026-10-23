#!/usr/bin/env bash
# Recreates the test database on a plain PostgreSQL server and applies all migrations.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/db-reset-test.sh
set -euo pipefail
DB="${TEST_DB_NAME:-flowmont_test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/supabase/tests/supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
echo "Test database $DB ready."
