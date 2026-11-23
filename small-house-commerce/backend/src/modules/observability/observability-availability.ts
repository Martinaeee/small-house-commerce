/** P1.5 availability: pure classification and uptime helpers. */

export type ProbeCheckValue = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ProbeRouteStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
export type ProbeSource = 'PROD' | 'EXTERNAL';
export type UptimeState = 'OK' | 'DEGRADED' | 'DOWN' | 'NO_DATA';

export interface ProbeRouteDefinition {
  key: string;
  path: string;
  /** Marker expected in the returned HTML; empty skips the DOM check. */
  domMarker: string;
}

export interface UptimeDay {
  day: string;
  state: UptimeState;
  uptimePct: number | null;
}

export interface UptimeAggregateRow {
  day: string;
  total: number;
  ok: number;
}

const PAGE_DEGRADED_MS = 3000;

/**
 * Product path has no safe default: probing a made-up slug would turn a
 * configuration gap into a fake DOWN. An empty path is recorded as UNKNOWN.
 */
export function probeRoutes(): ProbeRouteDefinition[] {
  const productPath = (process.env.PROBE_PRODUCT_PATH ?? '').trim();
  // The product route stays in the list even without a path: it reports
  // UNKNOWN, which is the honest answer, and it keeps the other routes from
  // looking complete.
  const routes: ProbeRouteDefinition[] = [
    { key: 'home', path: '/', domMarker: '<h1' },
    { key: 'collections', path: '/collections/all-products', domMarker: '<h1' },
    { key: 'product', path: productPath, domMarker: '<h1' },
  ];
  // The cart and checkout pages are optional: they need a session to be
  // meaningful, and probing them costs a request each.
  if (process.env.PROBE_INCLUDE_CHECKOUT !== 'false') {
    routes.push({ key: 'cart', path: '/cart', domMarker: '<h1' });
    routes.push({ key: 'checkout', path: '/checkout', domMarker: '<form' });
  }
  return routes;
}

/**
 * A FAIL anywhere is DOWN. UNKNOWN on DNS/TLS/HTTP means the evidence is
 * insufficient, so the route is UNKNOWN rather than green. DOM is a browser
 * signal: its absence degrades the route but its UNKNOWN does not block
 * availability.
 */
export function classifyProbe(input: {
  dns: ProbeCheckValue;
  tls: ProbeCheckValue;
  http: ProbeCheckValue;
  dom: ProbeCheckValue;
  latencyMs: number | null;
  degradedMs?: number;
}): ProbeRouteStatus {
  if (input.dns === 'FAIL' || input.tls === 'FAIL' || input.http === 'FAIL') return 'DOWN';
  if (input.dns === 'UNKNOWN' || input.tls === 'UNKNOWN' || input.http === 'UNKNOWN') {
    return 'UNKNOWN';
  }
  if (input.dom === 'FAIL') return 'DEGRADED';
  if (input.latencyMs !== null && input.latencyMs > (input.degradedMs ?? PAGE_DEGRADED_MS)) {
    return 'DEGRADED';
  }
  return 'OPERATIONAL';
}

export function overallProbeStatus(statuses: ProbeRouteStatus[]): ProbeRouteStatus {
  if (statuses.length === 0) return 'UNKNOWN';
  if (statuses.includes('DOWN')) return 'DOWN';
  if (statuses.includes('DEGRADED')) return 'DEGRADED';
  if (statuses.every((status) => status === 'OPERATIONAL')) return 'OPERATIONAL';
  return 'UNKNOWN';
}

export function probeReason(status: ProbeRouteStatus, routes: ProbeRouteStatus[]): string {
  if (status === 'OPERATIONAL') {
    return `All ${routes.length} key routes passed the latest probe round.`;
  }
  if (status === 'DOWN') {
    const down = routes.filter((route) => route === 'DOWN').length;
    return `${down} of ${routes.length} key routes are down.`;
  }
  if (status === 'DEGRADED') {
    const degraded = routes.filter((route) => route === 'DEGRADED').length;
    return `${degraded} of ${routes.length} key routes are degraded.`;
  }
  const unknown = routes.filter((route) => route === 'UNKNOWN').length;
  return `Probe evidence is missing or incomplete for ${unknown} of ${routes.length} key routes.`;
}

/** Asia/Manila calendar day strings for the last `days` days, oldest first. */
export function manilaDays(days: number, now: Date): string[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    out.push(formatter.format(new Date(now.getTime() - offset * 86_400_000)));
  }
  return out;
}

export function buildUptime(
  days: string[],
  rows: UptimeAggregateRow[],
): UptimeDay[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return days.map((day) => {
    const row = byDay.get(day);
    if (!row || row.total === 0) return { day, state: 'NO_DATA', uptimePct: null };
    const uptimePct = Math.round((row.ok / row.total) * 10000) / 100;
    const state: UptimeState =
      uptimePct >= 100 ? 'OK' : uptimePct >= 99 ? 'DEGRADED' : 'DOWN';
    return { day, state, uptimePct };
  });
}

export function nodeState(
  lastHeartbeatAt: Date | null,
  now: Date,
): 'ONLINE' | 'STALE' | 'OFFLINE' {
  if (!lastHeartbeatAt) return 'OFFLINE';
  const ageMs = now.getTime() - lastHeartbeatAt.getTime();
  if (ageMs <= 3 * 60_000) return 'ONLINE';
  if (ageMs <= 15 * 60_000) return 'STALE';
  return 'OFFLINE';
}
