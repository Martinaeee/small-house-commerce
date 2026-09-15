import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Category } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './dto/category.dto.js';

type CategoryNode = Category & { children: CategoryNode[] };

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin view: every category regardless of status. */
  async tree() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return buildTree(categories);
  }

  /** Storefront view: only ACTIVE categories. */
  async storefrontTree() {
    const categories = await this.prisma.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return buildTree(categories);
  }

  async create(input: CreateCategoryInput) {
    if (input.parentId === null) {
      input.parentId = undefined;
    }

    try {
      const category = await this.prisma.category.create({ data: input });
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      return category;
    } catch (error) {
      this.rethrowKnown(error);
    }
  }

  async update(id: string, input: UpdateCategoryInput) {
    if (input.parentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }
    if (input.parentId === null) {
      input.parentId = undefined;
    }

    await this.ensureExists(id);

    try {
      const category = await this.prisma.category.update({ where: { id }, data: input });
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      return category;
    } catch (error) {
      this.rethrowKnown(error);
    }
  }

  async remove(id: string) {
    await this.ensureExists(id);

    try {
      // Children are promoted to root (SetNull); products block the delete (Restrict).
      await this.prisma.category.delete({ where: { id } });
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      return { ok: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new BadRequestException('Category still has products');
      }
      throw error;
    }
  }

  private async ensureExists(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  private rethrowKnown(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A category with this slug already exists');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Parent category does not exist');
      }
    }
    throw error;
  }
}

function buildTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  for (const category of categories) {
    nodes.set(category.id, { ...category, children: [] });
  }

  for (const category of categories) {
    const node = nodes.get(category.id)!;

    if (category.parentId && nodes.has(category.parentId)) {
      nodes.get(category.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
