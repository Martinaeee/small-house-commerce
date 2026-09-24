const APPROVED_DATABASE = "small_house_variant_test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export interface E2EDatabaseTarget {
  database: string;
  host: string;
  port: string;
}

/**
 * Validate the exact disposable target before Playwright can run any command.
 * This is intentionally pure: callers can gate config/global setup and unit
 * tests can prove unsafe URLs fail before migrate/seed is invoked.
 */
export function assertE2EDatabaseUrl(
  databaseUrl: string | undefined,
): E2EDatabaseTarget {
  if (!databaseUrl) {
    throw new Error(
      `Task 5 E2E guard refused DATABASE_URL: it must target PostgreSQL database "${APPROVED_DATABASE}" on a loopback host.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      `Task 5 E2E guard refused DATABASE_URL: it is not a parseable PostgreSQL URL.`,
    );
  }

  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const port = parsed.port || "5432";

  if (protocol !== "postgresql:" && protocol !== "postgres:") {
    throw new Error(
      `Task 5 E2E guard refused DATABASE_URL: protocol must be postgresql:// or postgres://.`,
    );
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Task 5 E2E guard refused DATABASE_URL: host must be loopback (localhost, 127.0.0.1, or ::1), received "${host || "<empty>"}".`,
    );
  }
  if (port !== "5432") {
    throw new Error(
      `Task 5 E2E guard refused DATABASE_URL: port must be 5432, received "${port}".`,
    );
  }
  if (database !== APPROVED_DATABASE) {
    throw new Error(
      `Task 5 E2E guard refused DATABASE_URL: database must be exactly "${APPROVED_DATABASE}", received "${database || "<empty>"}".`,
    );
  }

  return { database, host, port };
}

export const TASK5_APPROVED_DATABASE = APPROVED_DATABASE;
