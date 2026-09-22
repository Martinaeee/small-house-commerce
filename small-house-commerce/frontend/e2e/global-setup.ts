import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Prepares the disposable test database before any server starts:
 *   1. prisma migrate deploy — full schema (Release A/B/C migrations).
 *   2. prisma/seed.ts — roles/permissions (the E2E admin needs SUPER_ADMIN)
 *      plus the reference warehouse/collections/homepage rows.
 *   3. prisma/seed-e2e.ts — the deterministic scenario products; refuses any
 *      database whose name is not test-like.
 *
 * Must stay in sync with playwright.config.ts (which passes the same URL to
 * both servers): E2E_DATABASE_URL overrides, else small_house_variant_test.
 */
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;

export default function globalSetup(): void {
  const backendDir = path.resolve(__dirname, "..", "..", "backend");
  const env = { ...process.env, DATABASE_URL: databaseUrl };

  const run = (command: string): void => {
    execSync(command, { cwd: backendDir, env, stdio: "inherit" });
  };

  run("pnpm exec prisma migrate deploy");
  run("pnpm exec tsx prisma/seed.ts");
  run("pnpm exec tsx prisma/seed-e2e.ts");
}
