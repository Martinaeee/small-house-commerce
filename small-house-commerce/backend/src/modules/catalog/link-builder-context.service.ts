import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface LinkBuilderContext {
  products: {
    id: string;
    name: string;
    slug: string;
    variants: { id: string; name: string }[];
    landingPages: {
      id: string;
      slug: string;
      title: string;
    }[];
  }[];
}

@Injectable()
export class LinkBuilderContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(now: Date = new Date()): Promise<LinkBuilderContext> {
    const products = await this.prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        variants: {
          where: { sku: { is: { status: 'ACTIVE' } } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        },
        landingPages: {
          where: {
            status: 'ACTIVE',
            AND: [
              { OR: [{ startAt: null }, { startAt: { lte: now } }] },
              { OR: [{ endAt: null }, { endAt: { gte: now } }] },
            ],
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            slug: true,
            titleOverride: true,
          },
        },
      },
    });

    return {
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        slug: product.slug,
        variants: product.variants,
        landingPages: product.landingPages.map((landingPage) => ({
          id: landingPage.id,
          slug: landingPage.slug,
          title: landingPage.titleOverride ?? product.name,
        })),
      })),
    };
  }
}
