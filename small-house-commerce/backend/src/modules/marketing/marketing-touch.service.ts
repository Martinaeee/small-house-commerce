import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { effectiveStatus } from '../catalog/landing/landing-page.util.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';
import { manilaVisitDay, normaliseAid } from './marketing-attribution.js';
import { marketingTouchClaimsSchema, type MarketingTouchClaims, type MarketingTouchInput } from './dto/marketing-touch.dto.js';

const DAY_MS = 864e5;
const META_ID = /^\d{6,20}$/;
type TouchResult = { credential: string | null; expiresAt: string | null; paid: boolean };
const emptyTouch: TouchResult = { credential: null, expiresAt: null, paid: false };
const emptyMetadata = {
  facebookPostId: null, campaignId: null, adsetId: null, adId: null,
  fbclid: null, fbc: null, fbp: null, referrer: null,
  utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null,
};
const productFields = { id: true, name: true, productCode: true, slug: true, status: true } as const;
type ProductForTouch = { id: string; name: string; productCode: string | null };

function pathSlug(path: string | undefined, prefix: 'lp' | 'products'): string | null {
  const match = path?.match(new RegExp(`^/${prefix}/([^/]+)/?$`));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function metaAdId(value: string | null | undefined): string | null {
  return typeof value === 'string' && META_ID.test(value) ? value : null;
}

function paidSignal(input: MarketingTouchInput): boolean {
  return Boolean(metaAdId(input.adId) || input.campaignId || input.adsetId || input.fbclid || /paid/i.test(input.utmMedium ?? ''));
}

@Injectable()
export class MarketingTouchService {
  private readonly key: Buffer;
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: CampaignLinksService,
    private readonly optimizers: OptimizersService,
    config: ConfigService,
  ) {
    this.key = Buffer.from(hkdfSync('sha256', config.getOrThrow<string>('jwt.secret'), 'luwag.marketing', 'marketing-touch:v1', 32));
    const days = config.get<number>('marketing.touchTtlDays') ?? 7;
    this.ttlMs = days * DAY_MS;
  }

  async touch(input: MarketingTouchInput): Promise<TouchResult> {
    const now = new Date();
    if (input.code !== undefined) return this.touchLink(input, now);
    if (input.aid !== undefined) return this.touchAid(input, now);
    return this.touchPage(input, now);
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
      if (touchedAt > now || expiresAt <= now || expiresAt - touchedAt > this.ttlMs) return null;
      return result.data;
    } catch { return null; }
  }

  private async touchLink(input: MarketingTouchInput, now: Date): Promise<TouchResult> {
    const link = await this.links.resolveTouch(input.code!);
    if (!link || link.disabled) return emptyTouch;
    const path = link.landingPage ? `/lp/${encodeURIComponent(link.landingPage.slug)}` : `/products/${encodeURIComponent(link.product.slug)}`;
    if ((input.productId && input.productId !== link.productId) || (input.landingPageId && input.landingPageId !== link.landingPageId) || (input.path && input.path.replace(/\/$/, '') !== path)) return emptyTouch;
    await this.recordVisits(link.id, link.landingPageId, input.visitKey, now);

    // AID wins over a conflicting legacy link, but the conflict is recorded.
    const rawAid = input.aid ? normaliseAid(input.aid) : null;
    if (rawAid && rawAid !== link.aidSnapshot) {
      const profile = await this.optimizers.resolveByAid(rawAid);
      if (profile && profile.status === 'ACTIVE') {
        return this.signAid({
          profile, aid: rawAid, input, product: link.product, landingPageId: link.landingPageId,
          publishedRevision: link.landingPage?.publishedRevision ?? null,
          sourceType: link.sourceType, paid: true, conflict: `AID ${rawAid} != link AID ${link.aidSnapshot}`, now,
        });
      }
    }

    const dynamicAdId = metaAdId(input.adId);
    const paid = link.sourceType === 'META_AD' || link.sourceType === 'FB_POST' || paidSignal(input);
    return this.sign({
      ...emptyMetadata,
      facebookPostId: null,
      campaignId: input.campaignId ?? link.campaignId,
      adsetId: input.adsetId ?? link.adsetId,
      adId: dynamicAdId ?? link.adId,
      fbclid: input.fbclid ?? null,
      fbc: input.fbc ?? null,
      fbp: input.fbp ?? null,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? link.utmSource,
      utmMedium: input.utmMedium ?? link.utmMedium,
      utmCampaign: input.utmCampaign ?? link.utmCampaign,
      utmContent: input.utmContent ?? link.utmContent,
      utmTerm: input.utmTerm ?? link.utmTerm,
      ownerUserId: link.ownerUserId, aid: link.aidSnapshot,
      ownerName: link.owner.optimizerProfile!.displayName,
      linkId: link.id, productId: link.productId, productName: link.product.name, productCode: link.product.productCode,
      landingPageId: link.landingPageId, publishedRevision: link.landingPage?.publishedRevision ?? null,
      sourceType: link.sourceType, legacy: false, paid,
    }, now);
  }

  private async touchAid(input: MarketingTouchInput, now: Date): Promise<TouchResult> {
    const profile = await this.optimizers.resolveByAid(input.aid!);
    if (!profile || profile.status !== 'ACTIVE') return emptyTouch;
    const user = await this.prisma.user.findUnique({ where: { id: profile.userId }, select: { status: true } });
    if (user?.status !== 'ACTIVE') return emptyTouch;
    const pageSlug = pathSlug(input.path, 'lp');
    const page = input.landingPageId || pageSlug ? await this.prisma.productLandingPage.findUnique({
      where: input.landingPageId ? { id: input.landingPageId } : { slug: pageSlug! },
      include: { product: { select: productFields } },
    }) : null;
    if (input.landingPageId || pageSlug) {
      if (!page || !page.publishedContent || page.product.status !== 'ACTIVE' || effectiveStatus(page, now) !== 'LIVE' || (input.productId && input.productId !== page.productId) || (input.path && input.path.replace(/\/$/, '') !== `/lp/${encodeURIComponent(page.slug)}`)) return emptyTouch;
      await this.recordVisits(null, page.id, input.visitKey, now);
    }
    const productSlug = pathSlug(input.path, 'products');
    const product = page?.product ?? (input.productId
      ? await this.prisma.product.findUnique({ where: { id: input.productId }, select: productFields })
      : productSlug
        ? await this.prisma.product.findFirst({ where: { slug: productSlug, status: 'ACTIVE' }, select: productFields })
        : null);
    if ((input.productId || productSlug) && (!product || product.status !== 'ACTIVE')) return emptyTouch;
    return this.signAid({
      profile, aid: input.aid!, input, product, landingPageId: page?.id ?? null,
      publishedRevision: page?.publishedRevision ?? null,
      sourceType: 'META_AD', paid: paidSignal(input), now,
    });
  }

  private async touchPage(input: MarketingTouchInput, now: Date): Promise<TouchResult> {
    const pageSlug = pathSlug(input.path, 'lp');
    const page = input.landingPageId || pageSlug ? await this.prisma.productLandingPage.findUnique({
      where: input.landingPageId ? { id: input.landingPageId } : { slug: pageSlug! },
      include: { product: { select: productFields } },
    }) : null;
    if (input.landingPageId || pageSlug) {
      if (!page || !page.publishedContent || page.product.status !== 'ACTIVE' || effectiveStatus(page, now) !== 'LIVE' || (input.productId && input.productId !== page.productId) || (input.path && input.path.replace(/\/$/, '') !== `/lp/${encodeURIComponent(page.slug)}`)) return emptyTouch;
      await this.recordVisits(null, page.id, input.visitKey, now);
    }
    // A page view without a paid parameter is not an attribution touch.
    return emptyTouch;
  }

  private signAid(input: {
    profile: { userId: string; displayName: string };
    aid: string;
    input: MarketingTouchInput;
    product: ProductForTouch | null;
    landingPageId: string | null;
    publishedRevision: number | null;
    sourceType: MarketingTouchClaims['sourceType'];
    paid: boolean;
    conflict?: string;
    now: Date;
  }): TouchResult {
    return this.sign({
      ...emptyMetadata,
      adId: metaAdId(input.input.adId),
      campaignId: input.input.campaignId ?? null,
      adsetId: input.input.adsetId ?? null,
      fbclid: input.input.fbclid ?? null,
      fbc: input.input.fbc ?? null,
      fbp: input.input.fbp ?? null,
      referrer: input.input.referrer ?? null,
      utmSource: input.input.utmSource ?? null,
      utmMedium: input.input.utmMedium ?? null,
      utmCampaign: input.input.utmCampaign ?? null,
      utmContent: input.input.utmContent ?? null,
      utmTerm: input.input.utmTerm ?? null,
      ownerUserId: input.profile.userId, aid: normaliseAid(input.aid)!, ownerName: input.profile.displayName,
      linkId: null, productId: input.product?.id ?? null, productName: input.product?.name ?? null, productCode: input.product?.productCode ?? null,
      landingPageId: input.landingPageId, publishedRevision: input.publishedRevision,
      sourceType: input.paid ? input.sourceType : 'ORGANIC', legacy: false, paid: input.paid,
      ...(input.conflict ? { attributionConflict: true, conflictDetail: input.conflict } : {}),
    }, input.now);
  }

  private sign(
    data: Omit<MarketingTouchClaims, 'purpose' | 'version' | 'touchedAt' | 'expiresAt'>,
    now: Date,
  ): TouchResult {
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    const payload: MarketingTouchClaims = { ...data, purpose: 'marketing-touch', version: 2, touchedAt: now.toISOString(), expiresAt };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { credential: `${body}.${createHmac('sha256', this.key).update(body).digest('base64url')}`, expiresAt, paid: Boolean(data.paid) };
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
