import { describe, expect, it } from 'vitest';
import { campaignLinkCreateSchema, campaignLinkQuerySchema, campaignLinkUpdateSchema } from './campaign-link.dto.js';

const base = { productId: '11111111-1111-4111-a111-111111111111', sourceType: 'FB_POST' as const };

describe('campaign link post DTOs', () => {
  it('allows a Facebook post without a name when the server can auto-name it', () => {
    expect(campaignLinkCreateSchema.parse({ ...base, postDate: '2026-11-03' })).toMatchObject({ postDate: '2026-11-03' });
  });

  it('still requires a name for a non-post link and rejects post fields on non-post links', () => {
    expect(campaignLinkCreateSchema.safeParse({ ...base, sourceType: 'META_AD' }).success).toBe(false);
    expect(campaignLinkCreateSchema.safeParse({ ...base, sourceType: 'META_AD', postDate: '2026-11-03' }).success).toBe(false);
  });

  it('rejects invalid calendar dates and unsafe Facebook URLs', () => {
    for (const postDate of ['2026-02-30', '2026-13-01', '11-03-2026']) {
      expect(campaignLinkCreateSchema.safeParse({ ...base, postDate }).success).toBe(false);
    }
    for (const postUrl of ['https://facebook.com.example.com/x', 'http://facebook.com/x', 'https://evil.test/x']) {
      expect(campaignLinkCreateSchema.safeParse({ ...base, postDate: '2026-11-03', postUrl }).success).toBe(false);
    }
  });

  it('edits metadata with expectedVersion and at least one field', () => {
    expect(campaignLinkUpdateSchema.parse({ name: 'New', expectedVersion: 0 })).toMatchObject({ name: 'New', expectedVersion: 0 });
    expect(campaignLinkUpdateSchema.parse({ postDate: null, expectedVersion: 0 })).toMatchObject({ postDate: null });
    expect(campaignLinkUpdateSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
  });

  it('rejects conflicting date filters and non-post date filters', () => {
    expect(campaignLinkQuerySchema.safeParse({ postDateFrom: '2026-11-03', postDateTo: '2026-11-02' }).success).toBe(false);
    expect(campaignLinkQuerySchema.safeParse({ postDateMissingOnly: 'true', postDateFrom: '2026-11-01' }).success).toBe(false);
    expect(campaignLinkQuerySchema.safeParse({ sourceType: 'META_AD', postDateFrom: '2026-11-01' }).success).toBe(false);
  });
});
