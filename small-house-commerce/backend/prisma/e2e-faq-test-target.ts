const APPROVED_DATABASE = 'small_house_variant_test';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface FaqE2ETestTarget {
  database: string;
  host: string;
  port: string;
}

/** Fail closed before an FAQ E2E fixture can mutate its disposable database. */
export function assertFaqE2ETestTarget(
  databaseUrl: string | undefined,
  approvedPort = '5432',
): FaqE2ETestTarget {
  if (!databaseUrl) throw new Error('FAQ E2E DATABASE_URL is required.');

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('FAQ E2E DATABASE_URL must be a parseable PostgreSQL URL.');
  }

  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const port = parsed.port || '5432';

  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new Error('FAQ E2E DATABASE_URL protocol must be PostgreSQL.');
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error('FAQ E2E DATABASE_URL host must be loopback.');
  }
  if (port !== approvedPort) {
    throw new Error(`FAQ E2E DATABASE_URL port must be ${approvedPort}.`);
  }
  if (database !== APPROVED_DATABASE) {
    throw new Error(
      `FAQ E2E database must be exactly ${APPROVED_DATABASE}.`,
    );
  }

  return { database, host, port };
}
