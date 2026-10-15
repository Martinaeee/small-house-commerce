import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { scopeFor, type MarketingAccount } from '../marketing/marketing-access.js';
import { effectiveStatus, type LandingEffectiveStatus } from './landing/landing-page.util.js';

export interface LinkBuilderContext {
  products: {
    id: string;
    name: string;
    productCode: string | null;
    slug: string;
    variants: { id: string; name: string }[];
    landingPages: {
      id: string;
      slug: string;
      title: string;
      ownerUserId: string | null;
      ownerName: string | null;
      aid: string | null;
      effectiveStatus: LandingEffectiveStatus;
    }[];
  }[];
}

@Injectable()
export class LinkBuilderContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(account: MarketingAccount, now: Date = new Date()): Promise<LinkBuilderContext> {
    const scope = scopeFor(account);
    const products = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true, name: true, productCode: true, slug: true,
        variants: {
          where: { sku: { is: { status: 'ACTIVE', price: { not: null } } } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        },
        landingPages: {
          where: {
            ...(scope.all ? {} : { ownerUserId: scope.ownerUserId }),
            status: 'ACTIVE',
            publishedContent: { not: Prisma.DbNull },
            OR: [{ endAt: null }, { endAt: { gte: now } }],
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true, slug: true, name: true, ownerUserId: true,
            status: true, startAt: true, endAt: true,
            owner: { select: { name: true, optimizerProfile: { select: { aid: true, displayName: true } } } },
          },
        },
      },
    });
    return { products: products.map((product) => ({
      id: product.id, name: product.name, productCode: product.productCode,
      slug: product.slug, variants: product.variants,
      landingPages: product.landingPages.map((page) => ({
        id: page.id, slug: page.slug, title: page.name,
        ownerUserId: page.ownerUserId,
        ownerName: page.owner?.optimizerProfile?.displayName ?? page.owner?.name ?? null,
        aid: page.owner?.optimizerProfile?.aid ?? null,
        effectiveStatus: effectiveStatus(page, now),
      })),
    })) };
  }
}
