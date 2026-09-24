import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;

/**
 * Playwright starts webServer plugins before globalSetup. Database preparation
 * therefore lives in e2e/bootstrap.ts, which guards and seeds before Nest
 * starts; this hook remains the final fail-closed guard before browser tests.
 */
export default function globalSetup(): void {
  assertE2EDatabaseUrl(databaseUrl);
}
