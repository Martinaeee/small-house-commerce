import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Category, type HeroStyle } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './dto/category.dto.js';
import { loadHeroStyles, saveHeroStyle } from './hero-style.util.js';

/** `heroStyle` is a separate table, so tree nodes carry it alongside. */
type CategoryNode = Category & { children: CategoryNode[]; heroStyle: HeroStyle | null };

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin view: every category regardless of status. */
  async tree() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return this.withHeroStyles(categories);
  }

  /** Storefront view: only ACTIVE categories. */
  async storefrontTree() {
    const categories = await this.prisma.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return this.withHeroStyles(categories);
  }

  private async withHeroStyles(categories: Category[]): Promise<CategoryNode[]> {
    const styles = await loadHeroStyles(
      this.prisma,
      'CATEGORY',
      categories.map((category) => category.id),
    );
    return buildTree(categories, styles);
  }

  async create(input: CreateCategoryInput) {
    // heroStyle is not a Category column: it lives in its own table and is
    // written separately (inside the same transaction).
    const { heroStyle, ...data } = input;
    if (data.parentId === null) {
      data.parentId = undefined;
    }

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({ data });
        await saveHeroStyle(tx, 'CATEGORY', created.id, heroStyle);
        return created;
      });
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
    const { heroStyle, ...data } = input;
    if (data.parentId === null) {
      data.parentId = undefined;
    }

    await this.ensureExists(id);

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.category.update({ where: { id }, data });
        await saveHeroStyle(tx, 'CATEGORY', id, heroStyle);
        return updated;
      });
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

function buildTree(
  categories: Category[],
  styles: Map<string, HeroStyle>,
): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  for (const category of categories) {
    nodes.set(category.id, {
      ...category,
      children: [],
      heroStyle: styles.get(category.id) ?? null,
    });
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
