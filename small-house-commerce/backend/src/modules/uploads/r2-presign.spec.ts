import { describe, expect, it } from 'vitest';
import { buildR2PresignedPutUrl, type R2Settings } from './r2-presign.js';

const settings: R2Settings = {
  accountId: 'acct123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretexample',
  bucket: 'smallhouse-catalog',
  publicBaseUrl: 'https://img.example.test/',
};
const NOW = new Date('2026-09-14T12:00:00Z');

function params(uploadUrl: string): URLSearchParams {
  return new URL(uploadUrl).searchParams;
}

describe('buildR2PresignedPutUrl', () => {
  it('builds a deterministic SigV4 PUT url scoped to the bucket key', () => {
    const r = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const u = new URL(r.uploadUrl);
    expect(u.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(u.pathname).toBe('/smallhouse-catalog/catalog/2026/uuid.jpg');
    expect(params(r.uploadUrl).get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(params(r.uploadUrl).get('X-Amz-Expires')).toBe('600');
    expect(params(r.uploadUrl).get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(params(r.uploadUrl).get('X-Amz-Date')).toBe('20260914T120000Z');
    expect(params(r.uploadUrl).get('X-Amz-Credential')).toBe(
      'AKIAEXAMPLE/20260914/auto/s3/aws4_request',
    );
    expect(params(r.uploadUrl).get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(r).toMatchObject({
      key: 'catalog/2026/uuid.jpg',
      expiresIn: 600,
      publicUrl: 'https://img.example.test/catalog/2026/uuid.jpg',
    });
  });

  it('is deterministic for identical inputs', () => {
    const a = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const b = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    expect(a.uploadUrl).toBe(b.uploadUrl);
  });

  it('signature changes when secret, content-type or time changes', () => {
    const base = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/jpeg', 600, NOW);
    const otherSecret = buildR2PresignedPutUrl(
      { ...settings, secretAccessKey: 'other' },
      'catalog/2026/uuid.jpg',
      'image/jpeg',
      600,
      NOW,
    );
    const otherType = buildR2PresignedPutUrl(settings, 'catalog/2026/uuid.jpg', 'image/png', 600, NOW);
    const otherTime = buildR2PresignedPutUrl(
      settings,
      'catalog/2026/uuid.jpg',
      'image/jpeg',
      600,
      new Date('2026-09-14T12:00:01Z'),
    );
    expect(otherSecret.uploadUrl).not.toBe(base.uploadUrl);
    expect(otherType.uploadUrl).not.toBe(base.uploadUrl);
    expect(otherTime.uploadUrl).not.toBe(base.uploadUrl);
  });
});
