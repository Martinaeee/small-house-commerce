import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { CampaignLinksController } from './campaign-links.controller.js';
import { MarketingGuard } from '../marketing.guard.js';
import { campaignLinkCreateSchema, campaignLinkUpdateSchema, campaignLinkVersionSchema } from '../dto/campaign-link.dto.js';

describe('campaign link write boundary', () => {
  it('uses the same owner-aware guard and exposes no hard delete or target retarget endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CampaignLinksController)).toContain(MarketingGuard);
    expect(Reflect.getMetadata(PATH_METADATA, CampaignLinksController)).toBe('admin/campaign-links');
    expect(CampaignLinksController.prototype).not.toHaveProperty('remove');
  });
  it('rejects arbitrary owner, raw AID, public URL and client code values', () => {
    const input = { productId: '11111111-1111-4111-a111-111111111111', name: 'Ad A', sourceType: 'META_AD' };
    expect(campaignLinkCreateSchema.safeParse(input).success).toBe(true);
    for (const key of ['ownerUserId', 'aid', 'targetUrl', 'code']) expect(campaignLinkCreateSchema.safeParse({ ...input, [key]: 'forged' }).success).toBe(false);
    expect(campaignLinkUpdateSchema.safeParse({ name: 'Rename', expectedVersion: 0, adId: 'new' }).success).toBe(false);
    expect(campaignLinkVersionSchema.safeParse({}).success).toBe(false);
  });
});
