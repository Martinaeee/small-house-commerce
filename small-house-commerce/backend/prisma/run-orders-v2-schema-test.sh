#!/usr/bin/env bash
# Creates the owned local database for the Orders V2 schema spec and runs it.
#
# The spec refuses to run against anything but a database this script owns:
# a local PostgreSQL instance with a name that starts with
# small_house_orders_v2_. It never touches the shared dev database and never
# touches production.
#
#   ./prisma/run-orders-v2-schema-test.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."

PGHOST=${PGHOST:-127.0.0.1}
PGPORT=${PGPORT:-5432}
PGUSER=${PGUSER:-postgres}
PGPASSWORD=${PGPASSWORD:-postgres}
CONTAINER=${PGCONTAINER:-small-house-postgres}
DB="small_house_orders_v2_$(date +%Y%m%d%H%M%S)"

run_sql() {
  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$1" -t -A -c "$2"
  else
    docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$1" -t -A -c "$2"
  fi
}

echo "creating $DB"
run_sql postgres "CREATE DATABASE $DB" >/dev/null

export DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB?schema=public"
npx prisma migrate deploy >/dev/null
echo "migrations applied"

export ORDERS_V2_TEST_DATABASE_URL="$DATABASE_URL"
npx vitest run prisma/orders-v2-schema.spec.ts
echo "done - the database is left in place so the spec can run again: $DB"
