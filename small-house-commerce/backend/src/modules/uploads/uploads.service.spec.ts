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

describe('UploadsService.saveLocal', () => {
  const config = { get: vi.fn(() => null) };
  const service = new UploadsService(config as never);

  it('writes the buffer under catalog/<year>/<uuid>.<ext> and returns its /uploads URL', async () => {
    const res = await service.saveLocal(Buffer.from('fake-jpeg'), 'image/jpeg');
    expect(res.url).toMatch(/^\/uploads\/catalog\/\d{4}\/[0-9a-f-]{36}\.jpg$/);
    expect(res.key).toMatch(/^catalog\/\d{4}\/[0-9a-f-]{36}\.jpg$/);
  });

  it('maps png and webp extensions', async () => {
    expect((await service.saveLocal(Buffer.from('x'), 'image/png')).url.endsWith('.png')).toBe(true);
    expect((await service.saveLocal(Buffer.from('x'), 'image/webp')).url.endsWith('.webp')).toBe(true);
  });

  it('rejects unsupported types and empty bodies', async () => {
    await expect(service.saveLocal(Buffer.from('x'), 'image/gif')).rejects.toThrow(/Unsupported media type/);
    await expect(service.saveLocal(Buffer.alloc(0), 'image/jpeg')).rejects.toThrow(/Empty upload/);
  });
});
