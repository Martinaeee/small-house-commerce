import { describe, expect, it } from 'vitest';
import {
  buildUptime,
  classifyProbe,
  manilaDays,
  nodeState,
  overallProbeStatus,
  probeReason,
} from './observability-availability.js';

describe('probe classification', () => {
  it('marks a failed check DOWN even when the rest passed', () => {
    expect(
      classifyProbe({ dns: 'PASS', tls: 'PASS', http: 'FAIL', dom: 'PASS', latencyMs: 120 }),
    ).toBe('DOWN');
    expect(classifyProbe({ dns: 'FAIL', tls: 'PASS', http: 'PASS', dom: 'PASS', latencyMs: 120 })).toBe(
      'DOWN',
    );
  });

  it('never turns missing evidence into OPERATIONAL', () => {
    expect(
      classifyProbe({ dns: 'UNKNOWN', tls: 'PASS', http: 'PASS', dom: 'PASS', latencyMs: 120 }),
    ).toBe('UNKNOWN');
    expect(
      classifyProbe({ dns: 'PASS', tls: 'UNKNOWN', http: 'PASS', dom: 'PASS', latencyMs: 120 }),
    ).toBe('UNKNOWN');
    expect(
      classifyProbe({ dns: 'PASS', tls: 'PASS', http: 'UNKNOWN', dom: 'PASS', latencyMs: 120 }),
    ).toBe('UNKNOWN');
  });

  it('degrades slow routes and missing DOM but does not block on DOM UNKNOWN', () => {
    expect(
      classifyProbe({ dns: 'PASS', tls: 'PASS', http: 'PASS', dom: 'PASS', latencyMs: 3_100 }),
    ).toBe('DEGRADED');
    expect(
      classifyProbe({ dns: 'PASS', tls: 'PASS', http: 'PASS', dom: 'FAIL', latencyMs: 200 }),
    ).toBe('DEGRADED');
    expect(
      classifyProbe({ dns: 'PASS', tls: 'PASS', http: 'PASS', dom: 'UNKNOWN', latencyMs: 200 }),
    ).toBe('OPERATIONAL');
  });
});

describe('overall status and reasons', () => {
  it('prioritises DOWN over DEGRADED and UNKNOWN', () => {
    expect(overallProbeStatus(['OPERATIONAL', 'DEGRADED', 'DOWN', 'UNKNOWN'])).toBe('DOWN');
    expect(overallProbeStatus(['OPERATIONAL', 'DEGRADED', 'UNKNOWN'])).toBe('DEGRADED');
  });

  it('requires every route to be OPERATIONAL for a green overall status', () => {
    expect(overallProbeStatus(['OPERATIONAL', 'OPERATIONAL'])).toBe('OPERATIONAL');
    expect(overallProbeStatus(['OPERATIONAL', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(overallProbeStatus([])).toBe('UNKNOWN');
  });

  it('states the reason with real counts', () => {
    expect(probeReason('OPERATIONAL', ['OPERATIONAL', 'OPERATIONAL'])).toMatch(/All 2 key routes/);
    expect(probeReason('DOWN', ['DOWN', 'OPERATIONAL', 'DOWN'])).toMatch(/2 of 3 key routes are down/);
    expect(probeReason('UNKNOWN', ['UNKNOWN', 'OPERATIONAL'])).toMatch(
      /missing or incomplete for 1 of 2/,
    );
  });
});

describe('uptime and node freshness', () => {
  it('keeps NO DATA distinct from 0%', () => {
    const days = manilaDays(2, new Date('2026-11-13T10:00:00Z'));
    const rows = [{ day: days[1], total: 2, ok: 2 }];
    const uptime = buildUptime(days, rows);
    expect(uptime[0]).toEqual({ day: days[0], state: 'NO_DATA', uptimePct: null });
    expect(uptime[1].state).toBe('OK');
    expect(uptime[1].uptimePct).toBe(100);
  });

  it('uses Manila calendar days', () => {
    const days = manilaDays(1, new Date('2026-11-13T16:30:00Z'));
    expect(days).toEqual(['2026-11-14']);
  });

  it('classifies node freshness at 3 and 15 minutes', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    expect(nodeState(new Date('2026-11-13T09:58:00Z'), now)).toBe('ONLINE');
    expect(nodeState(new Date('2026-11-13T09:50:00Z'), now)).toBe('STALE');
    expect(nodeState(new Date('2026-11-13T09:30:00Z'), now)).toBe('OFFLINE');
    expect(nodeState(null, now)).toBe('OFFLINE');
  });
});
