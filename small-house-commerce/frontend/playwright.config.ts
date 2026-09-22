import { defineConfig, devices } from "@playwright/test";

/**
 * Task 20 — Phase 1 browser acceptance gate.
 *
 * The gate runs the REAL stack: the worktree backend (typed catalog graph)
 * and the storefront frontend, both pointed at a disposable Postgres test
 * database that e2e/global-setup.ts migrates and seeds with one product per
 * variant scenario (backend/prisma/seed-e2e.ts).
 *
 * Run (from small-house-commerce/):
 *   pnpm --dir frontend exec playwright test e2e/variant-options-media.spec.ts
 *
 * Prereqs:
 *   - Postgres on :5432 (docker compose up -d) with the test database
 *     created once: `small_house_variant_test` (the seed refuses any
 *     non-test database name).
 *   - `pnpm --dir frontend exec playwright install chromium`.
 *
 * If an E2E run placed orders, re-seeding cannot delete the referenced
 * products — recreate the database for a fully clean gate:
 *   docker exec small-house-postgres psql -U postgres -d postgres -c \
 *     "DROP DATABASE IF EXISTS small_house_variant_test WITH (FORCE);
 *      CREATE DATABASE small_house_variant_test OWNER postgres"
 */

const FRONTEND_PORT = 3211;
const BACKEND_PORT = 3210;
// The storefront must be reached through `localhost` (never 127.0.0.1):
// Next 16 dev treats non-localhost origins as cross-origin, blocks /_next/hmr
// for them, and the HMR client then full-reloads in a loop — hydration never
// completes and every click lands on an un-hydrated tree.
const FRONTEND_ORIGIN = `http://localhost:${FRONTEND_PORT}`;

const TEST_DB = process.env.E2E_TEST_DB ?? "small_house_variant_test";
const PG_USER = process.env.E2E_PG_USER ?? "postgres";
const PG_PASSWORD = process.env.E2E_PG_PASSWORD ?? "postgres";
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${TEST_DB}?schema=public`;

const BACKEND_ENV = {
  PORT: String(BACKEND_PORT),
  HOST: "127.0.0.1",
  DATABASE_URL: E2E_DATABASE_URL,
  // Validated at boot (>= 32 chars); the gate never stores real secrets.
  JWT_SECRET: "e2e-gate-jwt-secret-0123456789abcdef0123456789",
  NODE_ENV: "test",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // The scenarios share one seeded database and a strict order of purchase
  // flows (cart -> checkout -> order -> account); keep them serial.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: FRONTEND_ORIGIN,
    // `next dev` compiles each route on first visit.
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --dir ../backend exec nest start",
      url: `http://127.0.0.1:${BACKEND_PORT}/api/v1`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: BACKEND_ENV,
    },
    {
      command: `pnpm exec next dev -p ${FRONTEND_PORT}`,
      url: FRONTEND_ORIGIN,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        API_TARGET: `http://127.0.0.1:${BACKEND_PORT}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
