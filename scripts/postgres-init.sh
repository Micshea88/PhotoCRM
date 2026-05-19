#!/bin/bash
# Postgres container init. Runs ONCE on a fresh `pathway_pgdata` volume.
#
# Two responsibilities:
#   1. Create the databases listed in POSTGRES_MULTIPLE_DATABASES.
#   2. Create a non-superuser app role (`pathway_app`) and set default
#      privileges so RLS policies actually enforce against the connection
#      identity. The default `postgres` user is SUPERUSER + BYPASSRLS, which
#      makes every RLS policy a no-op for the app — mirroring Neon's
#      non-superuser default locally is required for RLS tests to be
#      meaningful.
#
# Two URLs in .env.local:
#   - DATABASE_URL        → connects as pathway_app (subject to RLS) — used by app + tests
#   - DATABASE_URL_ADMIN  → connects as postgres   (superuser, bypasses RLS) — used by
#                           drizzle-kit migrate and scripts/seed.ts
#
# Source: multi-DB pattern is the standard docker-entrypoint-initdb.d idiom.
set -e
set -u

# Local-dev only password. The dev DB is bound to localhost; this is not
# a secret. The role intentionally has no SUPERUSER, no BYPASSRLS.
APP_ROLE="pathway_app"
APP_PASSWORD="pathway_app_dev"

echo "Creating app role $APP_ROLE (NOSUPERUSER, NOBYPASSRLS)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE ROLE "$APP_ROLE" WITH LOGIN PASSWORD '$APP_PASSWORD'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
EOSQL

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
  echo "Creating databases: $POSTGRES_MULTIPLE_DATABASES"
  for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
    echo "Creating database $db"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
      CREATE DATABASE "$db";
EOSQL

    echo "Granting privileges on $db to $APP_ROLE"
    # USAGE on schema is required to even reference tables. Default privileges
    # (per future statements made BY $POSTGRES_USER) auto-grant CRUD on any
    # NEW tables — so a `drizzle-kit migrate` that creates a table doesn't
    # require an explicit GRANT in every migration.
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
      GRANT CONNECT ON DATABASE "$db" TO "$APP_ROLE";
      GRANT USAGE ON SCHEMA public TO "$APP_ROLE";
      ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "$APP_ROLE";
      ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO "$APP_ROLE";
EOSQL
  done
fi
