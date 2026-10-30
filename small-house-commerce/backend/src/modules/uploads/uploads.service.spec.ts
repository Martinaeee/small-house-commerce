import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { R2Settings } from './r2-presign.js';
import { UploadsService } from './uploads.service.js';

const settings: R2Settings = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretexample',
  bucket: 'smallhouse-catalog',
  publicBaseUrl: 'https://img.example.test',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UploadsService.saveProcessed', () => {
  it('writes a server-named local derivative under the requested namespace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'luwag-brand-upload-'));
    try {
      const config = {
        get: vi.fn((key: string) => {
          if (key === 'r2') return null;
          if (key === 'upload.dir') return dir;
          if (key === 'upload.durable') return false;
          return undefined;
        }),
      };
      const service = new UploadsService(config as never);
      const body = Buffer.from('processed-webp');

      const result = await service.saveProcessed(body, 'image/webp', 'brand');

      expect(result).toMatchObject({
        url: expect.stringMatching(/^\/uploads\/brand\/\d{4}\/[0-9a-f-]{36}\.webp$/),
        key: expect.stringMatching(/^brand\/\d{4}\/[0-9a-f-]{36}\.webp$/),
        storage: 'LOCAL',
        durable: false,
      });
      await expect(readFile(join(dir, result.key))).resolves.toEqual(body);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uploads a Uint8Array through a signed R2 PUT and returns its public URL', async () => {
    const fetchMock = vi.fn(async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ) => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'r2') return settings;
        if (key === 'upload.durable') return false;
        return undefined;
      }),
    };
    const service = new UploadsService(config as never);
    const body = Buffer.from('processed-png');

    const result = await service.saveProcessed(body, 'image/png', 'brand');

    expect(result).toMatchObject({
      url: expect.stringMatching(/^https:\/\/img\.example\.test\/brand\/\d{4}\/[0-9a-f-]{36}\.png$/),
      key: expect.stringMatching(/^brand\/\d{4}\/[0-9a-f-]{36}\.png$/),
      storage: 'R2',
      durable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('X-Amz-Signature=');
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
    });
    expect(init!.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(init!.body)).toBe(false);
    expect(Buffer.from(init!.body as Uint8Array)).toEqual(body);
  });

  it('fails when the signed R2 PUT is not successful', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'r2') return settings;
        if (key === 'upload.durable') return false;
        return undefined;
      }),
    };
    const service = new UploadsService(config as never);

    await expect(
      service.saveProcessed(Buffer.from('x'), 'image/webp', 'brand'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

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

  it('stores the transcoded bytes for a large mp4 and keeps the .mp4 key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'luwag-video-upload-'));
    try {
      const transcoded = Buffer.from('tiny-faststart-mp4');
      const transcoder = { transcode: vi.fn(async () => ({ buffer: transcoded, contentType: 'video/mp4' })) };
      const localService = new UploadsService(
        { get: vi.fn((key: string) => (key === 'upload.dir' ? dir : null)) } as never,
        transcoder as never,
      );
      const big = Buffer.alloc(1_600_000, 0x5a); // above the 1.5 MB transcode gate

      const result = await localService.saveLocal(big, 'video/mp4');

      expect(transcoder.transcode).toHaveBeenCalledWith(big, 'video/mp4');
      expect(result.url).toMatch(/\.mp4$/);
      await expect(readFile(join(dir, result.key))).resolves.toEqual(transcoded);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the original bytes when the transcoder declines or grows the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'luwag-video-upload-'));
    try {
      const original = Buffer.alloc(1_600_000, 0x3c);
      const transcoder = { transcode: vi.fn(async () => null) };
      const localService = new UploadsService(
        { get: vi.fn((key: string) => (key === 'upload.dir' ? dir : null)) } as never,
        transcoder as never,
      );

      const result = await localService.saveLocal(original, 'video/mp4');
      expect((await readFile(join(dir, result.key))).equals(original)).toBe(true);

      const grower = { transcode: vi.fn(async () => ({ buffer: Buffer.alloc(2_000_000), contentType: 'video/mp4' })) };
      const growing = new UploadsService(
        { get: vi.fn((key: string) => (key === 'upload.dir' ? dir : null)) } as never,
        grower as never,
      );
      const result2 = await growing.saveLocal(original, 'video/mp4');
      expect(result2.url).toMatch(/\.mp4$/);
      const stored = await readFile(join(dir, result2.key));
      expect(stored.equals(original)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses an mp4 key when a MOV upload is successfully converted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'luwag-video-mov-'));
    try {
      const encoded = Buffer.from('smaller-mp4');
      const service = new UploadsService(
        { get: (key: string) => key === 'upload.dir' ? dir : null } as never,
        { transcode: async () => ({ buffer: encoded, contentType: 'video/mp4' }) } as never,
      );
      const result = await service.saveLocal(Buffer.alloc(1_600_000), 'video/quicktime');
      expect(result.key).toMatch(/\.mp4$/);
      expect((await readFile(join(dir, result.key))).equals(encoded)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never offers small videos or images to the transcoder', async () => {
    const transcoder = { transcode: vi.fn(async () => null) };
    const probing = new UploadsService(
      { get: vi.fn(() => null) } as never,
      transcoder as never,
    );
    await probing.saveLocal(Buffer.alloc(1_000, 0x21), 'video/mp4');
    await probing.saveLocal(Buffer.alloc(1_600_000, 0x21), 'image/jpeg');
    await probing.saveLocal(Buffer.alloc(1_600_000, 0x21), 'video/webm');
    expect(transcoder.transcode).not.toHaveBeenCalled();
  });
});
