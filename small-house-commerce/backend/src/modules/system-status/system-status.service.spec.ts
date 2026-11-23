import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemStatusService } from './system-status.service.js';

describe('SystemStatusService', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'luwag-status-'));
    file = join(dir, 'status.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the snapshot and marks a fresh file as not stale', () => {
    const generated = new Date('2026-10-27T10:00:00Z');
    writeFileSync(
      file,
      JSON.stringify({ generatedAt: generated.toISOString(), services: [] }),
    );
    const service = new SystemStatusService({
      filePath: file,
      now: () => generated.getTime() + 60_000,
    });

    expect(service.getStatus()).toMatchObject({
      generatedAt: generated.toISOString(),
      stale: false,
    });
  });

  it('marks a snapshot older than 15 minutes as stale', () => {
    const generated = new Date('2026-10-27T10:00:00Z');
    writeFileSync(file, JSON.stringify({ generatedAt: generated.toISOString() }));
    const service = new SystemStatusService({
      filePath: file,
      now: () => generated.getTime() + 16 * 60_000,
    });

    expect(service.getStatus().stale).toBe(true);
  });

  it('fails closed with 503 when the snapshot file is missing', () => {
    const service = new SystemStatusService({ filePath: file });

    expect(() => service.getStatus()).toThrow(ServiceUnavailableException);
  });

  it('fails closed with 503 when the snapshot is not valid JSON', () => {
    writeFileSync(file, 'not json');
    const service = new SystemStatusService({ filePath: file });

    expect(() => service.getStatus()).toThrow(ServiceUnavailableException);
  });

  it('fails closed with 503 when generatedAt is missing', async () => {
    writeFileSync(file, JSON.stringify({ services: [] }));
    const service = new SystemStatusService({ filePath: file });

    expect(() => service.getStatus()).toThrow(ServiceUnavailableException);
  });
});

describe('SystemStatusService access report', () => {
  let dir: string;
  let accessFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'luwag-access-'));
    accessFile = join(dir, 'access.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const report = {
    generatedAt: '2026-11-11T09:00:00Z',
    linesRead: 20000,
    requests: 1000,
    status5xx: 2,
    status4xx: 12,
    errorRate5xx: 0.2,
    images: { requests: 400, hit: 380, miss: 20, hitRate: 95 },
    top5xxPaths: [['/api/v1/storefront/cart', 2]],
    slowest: [{ ms: 1200, uri: '/_next/image?url=x&w=1440&q=75', status: 200 }],
    statusCounts: { '200': 986, '404': 12, '500': 2 },
  };

  it('parses a complete report and marks it fresh', async () => {
    writeFileSync(accessFile, JSON.stringify(report));
    const service = new SystemStatusService({
      accessFilePath: accessFile,
      now: () => Date.parse('2026-11-11T09:01:00Z'),
    });

    await expect(service.getAccessReport()).resolves.toMatchObject({
      generatedAt: report.generatedAt,
      stale: false,
      // `linesRead` in the collector output maps to `windowLines` in the API.
      windowLines: 20000,
      requests: 1000,
      status5xx: 2,
      errorRate5xx: 0.2,
      images: { requests: 400, hit: 380, miss: 20, hitRate: 95 },
      top5xxPaths: [['/api/v1/storefront/cart', 2]],
    });
  });

  it('marks a report older than 15 minutes as stale', async () => {
    writeFileSync(accessFile, JSON.stringify(report));
    const service = new SystemStatusService({
      accessFilePath: accessFile,
      now: () => Date.parse('2026-11-11T09:16:00Z'),
    });

    expect((await service.getAccessReport()).stale).toBe(true);
  });

  it('passes the probe traffic class through and defaults it for older reports', async () => {
    writeFileSync(
      accessFile,
      JSON.stringify({
        ...report,
        traffic: { human: 700, bot: 250, warmup: 20, probe: 30 },
        slowest: [
          { ms: 1200, uri: '/products/sofa', status: 200, traffic: 'probe' },
        ],
      }),
    );
    const service = new SystemStatusService({
      accessFilePath: accessFile,
      now: () => Date.parse('2026-11-11T09:01:00Z'),
    });

    const parsed = await service.getAccessReport();
    expect(parsed.traffic.probe).toBe(30);
    expect(parsed.slowest[0]?.traffic).toBe('probe');

    // A report written before the collector learned about the probes has no
    // probe field; it must read as zero rather than fail.
    writeFileSync(accessFile, JSON.stringify({ ...report, traffic: { human: 970, bot: 30, warmup: 0 } }));
    const older = await service.getAccessReport();
    expect(older.traffic.probe).toBe(0);
  });

  it('fails closed with 503 when the report is missing', async () => {
    const service = new SystemStatusService({ accessFilePath: accessFile });

    await expect(service.getAccessReport()).rejects.toThrow(ServiceUnavailableException);
  });

  it('fails closed with 503 when the report is not valid JSON', async () => {
    writeFileSync(accessFile, 'not json');
    const service = new SystemStatusService({ accessFilePath: accessFile });

    await expect(service.getAccessReport()).rejects.toThrow(ServiceUnavailableException);
  });

  it('fails closed with 503 when generatedAt is missing', async () => {
    writeFileSync(accessFile, JSON.stringify({ requests: 10 }));
    const service = new SystemStatusService({ accessFilePath: accessFile });

    await expect(service.getAccessReport()).rejects.toThrow(ServiceUnavailableException);
  });

  it('degrades unknown fields instead of throwing', async () => {
    writeFileSync(
      accessFile,
      JSON.stringify({
        generatedAt: '2026-11-11T09:00:00Z',
        images: 'nope',
        top5xxPaths: ['bad', ['/x', 'y']],
        slowest: [{ ms: 'slow' }],
        statusCounts: { '200': 'many' },
      }),
    );
    const service = new SystemStatusService({ accessFilePath: accessFile });

    await expect(service.getAccessReport()).resolves.toMatchObject({
      requests: 0,
      errorRate5xx: null,
      images: { requests: 0, hit: 0, miss: 0, hitRate: null },
      top5xxPaths: [],
      slowest: [],
      statusCounts: {},
    });
  });
});
