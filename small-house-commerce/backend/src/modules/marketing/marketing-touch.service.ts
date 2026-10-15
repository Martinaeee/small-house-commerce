import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { effectiveStatus } from '../catalog/landing/landing-page.util.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';
import { manilaVisitDay, normaliseAid } from './marketing-attribution.js';
import { marketingTouchClaimsSchema, type MarketingTouchClaims, type MarketingTouchInput } from './dto/marketing-touch.dto.js';

const WINDOW_MS = 7 * 864e5;
const emptyTouch = { credential: null, expiresAt: null };
const metadataFields = ['facebookPostId', 'campaignId', 'adsetId', 'adId', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as const;
const emptyMetadata = { facebookPostId: null, campaignId: null, adsetId: null, adId: null, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null };
const productFields = { id: true, name: true, productCode: true, slug: true, status: true } as const;

function pathSlug(path: string | undefined, prefix: 'lp' | 'products'): string | null {
  const match = path?.match(new RegExp(`^/${prefix}/([^/]+)/?$`));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

@Injectable()
export class MarketingTouchService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: CampaignLinksService,
    private readonly optimizers: OptimizersService,
    config: ConfigService,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', config.getOrThrow<string>('jwt.secret'), 'luwag.marketing', 'marketing-touch:v1', 32));
  }

  async touch(input: MarketingTouchInput): Promise<{ credential: string | null; expiresAt: string | null }> {
    const now = new Date();
    if (input.code !== undefined) {
      const link = await this.links.resolveTouch(input.code);
      if (!link || link.disabled) return emptyTouch;
      const path = link.landingPage ? `/lp/${encodeURIComponent(link.landingPage.slug)}` : `/products/${encodeURIComponent(link.product.slug)}`;
      if ((input.productId && input.productId !== link.productId) || (input.landingPageId && input.landingPageId !== link.landingPageId) || (input.path && input.path.replace(/\/$/, '') !== path)) return emptyTouch;
      await this.recordVisits(link.id, link.landingPageId, input.visitKey, now);
      return this.sign({
        ...emptyMetadata,
        ...Object.fromEntries(metadataFields.filter((field) => field !== 'facebookPostId').map((field) => [field, link[field]])),
        ownerUserId: link.ownerUserId, aid: link.aidSnapshot,
        ownerName: link.owner.optimizerProfile!.displayName,
        linkId: link.id, productId: link.productId, productName: link.product.name, productCode: link.product.productCode,
        landingPageId: link.landingPageId, publishedRevision: link.landingPage?.publishedRevision ?? null,
        sourceType: link.sourceType, legacy: false,
      }, now);
    }

    const pageSlug = pathSlug(input.path, 'lp');
    const page = input.landingPageId || pageSlug ? await this.prisma.productLandingPage.findUnique({
      where: input.landingPageId ? { id: input.landingPageId } : { slug: pageSlug! },
      include: { product: { select: productFields }, owner: { select: { status: true, optimizerProfile: { select: { aid: true, displayName: true, status: true } } } } },
    }) : null;
    if (input.landingPageId || pageSlug) {
      if (!page || !page.publishedContent || page.product.status !== 'ACTIVE' || effectiveStatus(page, now) !== 'LIVE' || (input.productId && input.productId !== page.productId) || (input.path && input.path.replace(/\/$/, '') !== `/lp/${encodeURIComponent(page.slug)}`)) return emptyTouch;
      await this.recordVisits(null, page.id, input.visitKey, now);
    }

    if (input.aid !== undefined) {
      const profile = await this.optimizers.resolveByAid(input.aid);
      if (!profile || profile.status !== 'ACTIVE') return emptyTouch;
      const user = await this.prisma.user.findUnique({ where: { id: profile.userId }, select: { status: true } });
      if (user?.status !== 'ACTIVE') return emptyTouch;
      const productSlug = pathSlug(input.path, 'products');
      const product = page?.product ?? (input.productId || productSlug ? await this.prisma.product.findUnique({ where: input.productId ? { id: input.productId } : { slug: productSlug! }, select: productFields }) : null);
      if ((input.productId || productSlug) && (!product || product.status !== 'ACTIVE')) return emptyTouch;
      return this.sign({
        ...emptyMetadata,
        ...Object.fromEntries(metadataFields.map((field) => [field, input[field] ?? null])),
        ownerUserId: profile.userId, aid: normaliseAid(input.aid)!, ownerName: profile.displayName,
        linkId: null, productId: product?.id ?? null, productName: product?.name ?? null, productCode: product?.productCode ?? null,
        landingPageId: page?.id ?? null, publishedRevision: page?.publishedRevision ?? null,
        sourceType: input.sourceType ?? 'ORGANIC', legacy: true,
      }, now);
    }

    if (!page?.ownerUserId || page.owner?.status !== 'ACTIVE' || page.owner.optimizerProfile?.status !== 'ACTIVE') return emptyTouch;
    return this.sign({
      ...emptyMetadata,
      ownerUserId: page.ownerUserId, aid: page.owner.optimizerProfile.aid, ownerName: page.owner.optimizerProfile.displayName,
      linkId: null, productId: page.productId, productName: page.product.name, productCode: page.product.productCode,
      landingPageId: page.id, publishedRevision: page.publishedRevision,
      sourceType: 'DIRECT', legacy: false,
    }, now);
  }

  async resolve(credential: unknown): Promise<MarketingTouchClaims | null> {
    if (typeof credential !== 'string' || credential.length > 8192) return null;
    const parts = credential.split('.');
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const mac = Buffer.from(parts[1], 'base64url');
    const expected = createHmac('sha256', this.key).update(parts[0]).digest();
    if (mac.length !== expected.length || mac.toString('base64url') !== parts[1] || !timingSafeEqual(mac, expected)) return null;
    try {
      const result = marketingTouchClaimsSchema.safeParse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
      if (!result.success) return null;
      const touchedAt = Date.parse(result.data.touchedAt), expiresAt = Date.parse(result.data.expiresAt), now = Date.now();
      if (touchedAt > now || expiresAt <= now || expiresAt - touchedAt !== WINDOW_MS) return null;
      return result.data;
    } catch { return null; }
  }

  private sign(data: Omit<MarketingTouchClaims, 'purpose' | 'version' | 'touchedAt' | 'expiresAt'>, now: Date) {
    const expiresAt = new Date(now.getTime() + WINDOW_MS).toISOString();
    const payload: MarketingTouchClaims = { ...data, purpose: 'marketing-touch', version: 1, touchedAt: now.toISOString(), expiresAt };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { credential: `${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`, expiresAt };
  }

  private async recordVisits(linkId: string | null, landingPageId: string | null, visitKey: string, now: Date) {
    if (!linkId && !landingPageId) return;
    const visitDay = manilaVisitDay(now);
    await this.prisma.$transaction(async (tx) => {
      if (linkId) await tx.campaignLinkVisit.createMany({ data: { linkId, visitKey, visitDay, createdAt: now }, skipDuplicates: true });
      if (landingPageId) await tx.landingPageVisit.createMany({ data: { landingPageId, visitKey, visitDay, createdAt: now }, skipDuplicates: true });
    });
  }
}
