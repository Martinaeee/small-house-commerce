import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProductsService } from '../catalog/products.service.js';
import { saveHeroStyle, loadHeroStyles } from '../catalog/hero-style.util.js';
import type {
  CollectionQuery,
  CreateCollectionInput,
  UpdateCollectionInput,
} from './dto/collection.dto.js';

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  // --- storefront -----------------------------------------------------------

  /** Navigation/landing collections for the header and homepage. */
  async storefrontList(query: { type?: string; page?: number; pageSize?: number }) {
    const where: Prisma.CollectionWhereInput = { status: 'ACTIVE' };
    if (query.type) where.type = query.type as never;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.collection.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          heroImage: true,
          sortOrder: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: query.pageSize ?? 50,
        skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 50),
      }),
      this.prisma.collection.count({ where }),
    ]);

    return { items, total };
  }

  /** Collection detail with its enabled CMS sections. */
  async storefrontGetBySlug(slug: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        description: true,
        heroImage: true,
        seoTitle: true,
        seoDescription: true,
        sections: {
          where: { enabled: true },
          orderBy: { sortOrder: 'asc' },
          select: { sectionType: true, contentJson: true, sortOrder: true },
        },
      },
    });

    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    // HeroStyle carries no relation (it is polymorphic across owners), so it
    // is fetched alongside rather than through `select`.
    const heroStyle = await this.prisma.heroStyle.findUnique({
      where: {
        ownerType_ownerId: { ownerType: 'COLLECTION', ownerId: collection.id },
      },
    });

    return { ...collection, heroStyle };
  }

  /**
   * Products in a collection, in membership order, with per-SKU
   * availableInventory so cards can render stock state without extra calls.
   * Optional filters (COLLECTION_SPEC §12): room / solution / price band.
   */
  async storefrontProducts(
    slug: string,
    query: { page?: number; pageSize?: number; room?: string; solution?: string; minPrice?: number; maxPrice?: number },
  ) {
    const collection = await this.prisma.collection.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!collection) {
      throw new NotFoundException('Collection not found');
    }

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 24, 48);

    const productWhere: Prisma.ProductWhereInput = { status: 'ACTIVE' };
    if (query.room) productWhere.room = query.room as never;
    if (query.solution) productWhere.solutions = { has: query.solution as never };
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      productWhere.variants = {
        some: {
          sku: { price: { gte: query.minPrice, lte: query.maxPrice } },
        },
      };
    }

    const membershipWhere: Prisma.CollectionProductWhereInput = {
      collectionId: collection.id,
      product: productWhere,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.collectionProduct.findMany({
        where: membershipWhere,
        select: {
          product: {
            select: { id: true },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.collectionProduct.count({ where: membershipWhere }),
    ]);

    const productIds = rows.map(({ product }) => product.id);
    const items = await this.products.storefrontByIds(productIds);

    return { items, total, page, pageSize };
  }

  // --- admin ----------------------------------------------------------------

  async list(query: CollectionQuery) {
    const where: Prisma.CollectionWhereInput = {};
    if (query.type) where.type = query.type as never;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.collection.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.collection.count({ where }),
    ]);

    // HeroStyle has no relation to its owner, so it is merged in by hand.
    const styles = await loadHeroStyles(
      this.prisma,
      'COLLECTION',
      items.map((item) => item.id),
    );

    return {
      items: items.map((item) => ({
        ...item,
        heroStyle: styles.get(item.id) ?? null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(input: CreateCollectionInput) {
    const { productIds, heroStyle, ...data } = input;

    const existing = await this.prisma.collection.findUnique({ where: { slug: data.slug } });
    if (existing) {
      throw new BadRequestException('A collection with this slug already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const collection = await tx.collection.create({
        data: {
          ...data,
          products: {
            create: productIds.map((productId, index) => ({
              productId,
              sortOrder: index,
            })),
          },
        },
        include: { _count: { select: { products: true } } },
      });
      await saveHeroStyle(tx, 'COLLECTION', collection.id, heroStyle);
      return collection;
    });
  }

  async update(id: string, input: UpdateCollectionInput) {
    const { productIds, heroStyle, ...data } = input;
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Collection not found');
    }

    return this.prisma.$transaction(async (tx) => {
      if (data.slug) {
        const clash = await tx.collection.findUnique({ where: { slug: data.slug } });
        if (clash && clash.id !== id) {
          throw new BadRequestException('A collection with this slug already exists');
        }
      }

      const collection = await tx.collection.update({
        where: { id },
        data,
      });

      if (productIds) {
        await tx.collectionProduct.deleteMany({ where: { collectionId: id } });
        await tx.collectionProduct.createMany({
          data: productIds.map((productId, index) => ({
            collectionId: id,
            productId,
            sortOrder: index,
          })),
        });
      }

      await saveHeroStyle(tx, 'COLLECTION', id, heroStyle);
      return collection;
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.collection.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Collection not found');
    }
    await this.prisma.collection.delete({ where: { id } });
    return { id };
  }
}
