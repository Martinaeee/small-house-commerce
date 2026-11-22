import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExternalProbeService,
  probeSignature,
  type ExternalProbePayload,
} from './external-probe.service.js';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const SECRET = 'external-probe-test-secret';

function payload(overrides: Partial<ExternalProbePayload> = {}): ExternalProbePayload {
  return {
    nodeKey: 'external-sg',
    runId: 'run-1',
    checkedAt: NOW.toISOString(),
    routes: [
      {
        key: 'home',
        path: '/',
        status: 'OPERATIONAL',
        dns: 'PASS',
        tls: 'PASS',
        http: 'PASS',
        httpStatus: 200,
        latencyMs: 180,
        dom: 'PASS',
      },
      {
        key: 'checkout',
        path: '/checkout',
        status: 'DEGRADED',
        dns: 'PASS',
        tls: 'PASS',
        http: 'PASS',
        httpStatus: 200,
        latencyMs: 3200,
        dom: 'PASS',
      },
    ],
    ...overrides,
  };
}

function signed(body: unknown, timestamp = String(Math.floor(NOW.getTime() / 1000))) {
  return { timestamp, signature: probeSignature(SECRET, timestamp, body) };
}

function prismaMock(options: { duplicates?: number } = {}) {
  return {
    syntheticProbeRun: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({
        count: options.duplicates ? 0 : data.length,
      })),
    },
    probeNodeHeartbeat: {
      create: vi.fn(async () => ({ id: 'heartbeat-1' })),
    },
  };
}

describe('ExternalProbeService ingestion', () => {
  beforeEach(() => {
    vi.stubEnv('EXTERNAL_PROBE_SECRET', SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a correctly signed round and forces EXTERNAL', async () => {
    const body = payload();
    const { timestamp, signature } = signed(body);
    const prisma = prismaMock();
    const service = new ExternalProbeService(prisma as never);
    const result = await service.ingest(body, timestamp, signature, NOW);

    expect(result).toEqual({ accepted: 2, duplicates: 0 });
    expect(prisma.syntheticProbeRun.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ environment: 'EXTERNAL', routeKey: 'home', runId: 'run-1' }),
      ]),
      skipDuplicates: true,
    });
  });

  it('rejects a bad signature and a stale timestamp', async () => {
    const body = payload();
    const service = new ExternalProbeService(prismaMock() as never);
    const bad = signed(body);
    await expect(
      service.ingest(body, bad.timestamp, 'sha256=deadbeef', NOW),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const stale = String(Math.floor(NOW.getTime() / 1000) - 180);
    await expect(
      service.ingest(body, stale, probeSignature(SECRET, stale, body), NOW),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the shared secret is not configured', async () => {
    vi.stubEnv('EXTERNAL_PROBE_SECRET', '');
    const body = payload();
    const { timestamp, signature } = signed(body);
    const service = new ExternalProbeService(prismaMock() as never);
    await expect(service.ingest(body, timestamp, signature, NOW)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects duplicate route keys and invalid statuses', async () => {
    const service = new ExternalProbeService(prismaMock() as never);
    const duplicated = payload({
      routes: [
        { key: 'home', path: '/', status: 'OPERATIONAL', dns: 'PASS', tls: 'PASS', http: 'PASS', dom: 'PASS' },
        { key: 'home', path: '/again', status: 'OPERATIONAL', dns: 'PASS', tls: 'PASS', http: 'PASS', dom: 'PASS' },
      ],
    });
    const first = signed(duplicated);
    await expect(
      service.ingest(duplicated, first.timestamp, first.signature, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);

    const invalid = payload({
      routes: [
        { key: 'home', path: '/', status: 'SUCCESS', dns: 'PASS', tls: 'PASS', http: 'PASS', dom: 'PASS' },
      ],
    });
    const second = signed(invalid);
    await expect(
      service.ingest(invalid, second.timestamp, second.signature, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats a replayed round as an idempotent no-op', async () => {
    const body = payload();
    const { timestamp, signature } = signed(body);
    const prisma = prismaMock({ duplicates: 1 });
    const service = new ExternalProbeService(prisma as never);
    const result = await service.ingest(body, timestamp, signature, NOW);
    expect(result).toEqual({ accepted: 0, duplicates: 2 });
  });
});

describe('ExternalProbeService heartbeat', () => {
  beforeEach(() => vi.stubEnv('EXTERNAL_PROBE_SECRET', SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it('stores a signed heartbeat and treats a duplicate as accepted:false', async () => {
    const body = { nodeKey: 'external-sg', reportedAt: NOW.toISOString() };
    const { timestamp, signature } = signed(body);
    const service = new ExternalProbeService(prismaMock() as never);
    expect(await service.heartbeat(body, timestamp, signature, NOW)).toEqual({ accepted: true });

    const prismaDuplicate = {
      probeNodeHeartbeat: {
        create: vi.fn(async () => {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }),
      },
    };
    expect(
      await new ExternalProbeService(prismaDuplicate as never).heartbeat(
        body,
        timestamp,
        signature,
        NOW,
      ),
    ).toEqual({ accepted: false });
  });
});
