import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { R2Settings } from './r2-presign.js';
import { UploadsService } from './uploads.service.js';

const settings: R2Settings = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretexample',
  bucket: 'smallhouse-catalog',
  publicBaseUrl: 'https://img.example.test',
};

describe('UploadsService.presign', () => {
  it('503s when R2 is not configured (boot still succeeds without env)', () => {
    const undefinedConfig = { get: vi.fn(() => undefined) };
    const partialConfig = { get: vi.fn(() => ({ ...settings, bucket: null })) };
    expect(() =>
      new UploadsService(undefinedConfig as never).presign('image/jpeg', 'a.jpg'),
    ).toThrow(ServiceUnavailableException);
    expect(() =>
      new UploadsService(partialConfig as never).presign('image/jpeg', 'a.jpg'),
    ).toThrow(ServiceUnavailableException);
  });

  it('mints a year/uuid key with the mapped extension and 10-minute expiry', () => {
    const config = { get: vi.fn((key: string) => (key === 'r2' ? settings : undefined)) };
    const service = new UploadsService(config as never);
    const jpg = service.presign('image/jpeg', 'photo.JPG');
    expect(jpg.key).toMatch(/^catalog\/2026\/[0-9a-f-]{36}\.jpg$/);
    expect(jpg.expiresIn).toBe(600);
    expect(jpg.publicUrl).toBe(`https://img.example.test/${jpg.key}`);
    expect(new URL(jpg.uploadUrl).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

    expect(service.presign('image/png', 'p.png').key).toMatch(/\.png$/);
    expect(service.presign('image/webp', 'p.webp').key).toMatch(/\.webp$/);
  });
});
