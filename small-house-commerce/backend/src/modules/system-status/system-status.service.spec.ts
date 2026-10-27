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

  it('fails closed with 503 when generatedAt is missing', () => {
    writeFileSync(file, JSON.stringify({ services: [] }));
    const service = new SystemStatusService({ filePath: file });

    expect(() => service.getStatus()).toThrow(ServiceUnavailableException);
  });
});
