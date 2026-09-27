import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { LinkEntityType, LinkLookup } from './homepage-validation.js';

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

@Injectable()
export class PrismaLinkLookup implements LinkLookup {
  constructor(private readonly prisma: PrismaService) {}

  async productStatuses(
    ids: string[],
  ): Promise<Map<string, 'ACTIVE' | 'DRAFT' | 'DISABLED'>> {
    const input = uniqueIds(ids);
    if (input.length === 0) return new Map();

    const rows = await this.prisma.product.findMany({
      where: { id: { in: input } },
      select: { id: true, status: true },
    });
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  async collectionExists(ids: string[]): Promise<Set<string>> {
    const input = uniqueIds(ids);
    if (input.length === 0) return new Set();

    const rows = await this.prisma.collection.findMany({
      where: { id: { in: input } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async categoryExists(ids: string[]): Promise<Set<string>> {
    const input = uniqueIds(ids);
    if (input.length === 0) return new Set();

    const rows = await this.prisma.category.findMany({
      where: { id: { in: input } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async landingExists(ids: string[]): Promise<Set<string>> {
    const input = uniqueIds(ids);
    if (input.length === 0) return new Set();

    const rows = await this.prisma.productLandingPage.findMany({
      where: { id: { in: input } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async slugs(type: LinkEntityType, ids: string[]): Promise<Map<string, string>> {
    const input = uniqueIds(ids);
    if (input.length === 0) return new Map();

    switch (type) {
      case 'PRODUCT': {
        const rows = await this.prisma.product.findMany({
          where: { id: { in: input } },
          select: { id: true, slug: true },
        });
        return new Map(rows.map((row) => [row.id, row.slug]));
      }
      case 'COLLECTION': {
        const rows = await this.prisma.collection.findMany({
          where: { id: { in: input } },
          select: { id: true, slug: true },
        });
        return new Map(rows.map((row) => [row.id, row.slug]));
      }
      case 'CATEGORY': {
        const rows = await this.prisma.category.findMany({
          where: { id: { in: input } },
          select: { id: true, slug: true },
        });
        return new Map(rows.map((row) => [row.id, row.slug]));
      }
      case 'LANDING': {
        const rows = await this.prisma.productLandingPage.findMany({
          where: { id: { in: input } },
          select: { id: true, slug: true },
        });
        return new Map(rows.map((row) => [row.id, row.slug]));
      }
    }
  }
}
