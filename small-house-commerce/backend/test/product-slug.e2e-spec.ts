import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type ProductStatus } from '../src/generated/prisma/client.js';
import { CatalogGraphService } from '../src/modules/catalog/catalog-graph.service.js';
import { createProductSchema } from '../src/modules/catalog/dto/product.dto.js';
import { ProductsService } from '../src/modules/catalog/products.service.js';

const raw = process.env.PRODUCT_SLUG_TEST_DATABASE_URL;
if (raw) {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== '5567' || url.pathname !== '/small_house_slug_test' || url.search) {
    throw new Error('Product slug tests require the dedicated local slug database on port 5567.');
  }
}

const suite = raw ? describe : describe.skip;
const categoryId = randomUUID();
let prisma: PrismaClient;
let service: ProductsService;

suite('ACTIVE-only product slug uniqueness', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: raw! }) });
    service = new ProductsService(
      prisma as never,
      { summaryForProducts: async () => new Map() } as never,
      { stockBySku: async () => new Map() } as never,
      new CatalogGraphService(prisma as never),
    );
    await prisma.category.create({ data: { id: categoryId, name: 'Slug tests', slug: `slug-tests-${categoryId}` } });
  });

  afterEach(async () => {
    await prisma.product.deleteMany({ where: { categoryId } });
  });

  afterAll(async () => {
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  function create(status: ProductStatus, slug = 'same-slug') {
    return service.create(createProductSchema.parse({ name: 'Slug fixture', categoryId, slug, status }));
  }

  const statuses: ProductStatus[] = ['DRAFT', 'DISABLED', 'ACTIVE'];
  it.each(statuses.flatMap(first => statuses.map(second => ({ first, second }))))(
    'allows $first/$second sharing unless both are ACTIVE', async ({ first, second }) => {
      const original = await create(first);
      if (first === 'ACTIVE' && second === 'ACTIVE') {
        await expect(create(second)).rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
        expect(await prisma.product.count({ where: { categoryId } })).toBe(1);
      } else {
        const duplicate = await create(second);
        expect(duplicate.id).not.toBe(original.id);
        expect(duplicate.status).toBe(second);
        expect(duplicate.slug).toBe('same-slug');
      }
    },
  );

  it('allows an ACTIVE product to save its unchanged slug', async () => {
    const product = await create('ACTIVE');
    const saved = await service.update(product.id, { slug: product.slug, name: 'Updated' });
    expect(saved).toMatchObject({ id: product.id, slug: 'same-slug', name: 'Updated', status: 'ACTIVE' });
  });

  it('rejects activation without a slug change and preserves the old draft', async () => {
    await create('ACTIVE');
    const draft = await create('DRAFT');
    await expect(service.update(draft.id, { name: 'Must roll back', status: 'ACTIVE' }))
      .rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
    expect(await prisma.product.findUnique({ where: { id: draft.id } }))
      .toMatchObject({ name: 'Slug fixture', status: 'DRAFT', slug: 'same-slug' });
  });

  it('rejects a conflicting ACTIVE slug edit without changing either product', async () => {
    await create('ACTIVE');
    const product = await create('ACTIVE', 'other-slug');
    await expect(service.update(product.id, { slug: 'same-slug' }))
      .rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toMatchObject({ slug: 'other-slug', status: 'ACTIVE' });
  });

  it('preserves the graph revision and scalars when a typed activation conflicts', async () => {
    await create('ACTIVE');
    const draft = await create('DRAFT');
    await expect(service.update(draft.id, {
      status: 'ACTIVE', name: 'Must roll back', catalogGraphVersion: 0,
      catalogGraph: { options: [], variants: [], media: [], retirements: { optionIds: [], optionValueIds: [], variantIds: [], mediaIds: [] } },
    })).rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
    expect(await prisma.product.findUnique({ where: { id: draft.id } }))
      .toMatchObject({ name: 'Slug fixture', status: 'DRAFT', catalogGraphVersion: 0 });
  });

  it('rolls back every selected row when two selected drafts share a slug', async () => {
    const a = await create('DRAFT');
    const b = await create('DISABLED');
    await expect(service.bulkSetStatus([a.id, b.id], 'ACTIVE'))
      .rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
    expect((await prisma.product.findMany({ where: { categoryId }, orderBy: { createdAt: 'asc' } })).map(row => row.status))
      .toEqual(['DRAFT', 'DISABLED']);
  });

  it('rolls back unrelated selected rows when an existing ACTIVE product owns the slug', async () => {
    await create('ACTIVE');
    const a = await create('DRAFT', 'available-slug');
    const b = await create('DISABLED');
    await expect(service.bulkSetStatus([a.id, b.id], 'ACTIVE'))
      .rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
    expect(await prisma.product.findUnique({ where: { id: a.id } })).toMatchObject({ status: 'DRAFT' });
    expect(await prisma.product.findUnique({ where: { id: b.id } })).toMatchObject({ status: 'DISABLED' });
  });

  it('releases a slug on deactivation but prevents reactivation after reuse', async () => {
    const old = await create('ACTIVE');
    await service.update(old.id, { status: 'DISABLED' });
    const replacement = await create('ACTIVE');
    await expect(service.update(old.id, { status: 'ACTIVE' }))
      .rejects.toMatchObject({ response: { code: 'PRODUCT_SLUG_CONFLICT' } });
    expect(await prisma.product.findUnique({ where: { id: replacement.id } })).toMatchObject({ status: 'ACTIVE' });
  });

  it.each(['COMMIT', 'ROLLBACK'] as const)(
    'protects concurrent direct activations when the first transaction uses %s', async action => {
      const a = await create('DRAFT');
      const b = await create('DRAFT');
      const first = new PrismaClient({ adapter: new PrismaPg({ connectionString: raw! }) });
      const second = new PrismaClient({ adapter: new PrismaPg({ connectionString: raw! }) });
      let markReady!: () => void;
      let releaseFirst!: () => void;
      const ready = new Promise<void>(resolve => { markReady = resolve; });
      const release = new Promise<void>(resolve => { releaseFirst = resolve; });
      const rollback = new Error('Intentional test rollback');
      try {
        const leader = first.$transaction(async tx => {
          await tx.product.update({ where: { id: a.id }, data: { status: 'ACTIVE' } });
          markReady();
          await release;
          if (action === 'ROLLBACK') throw rollback;
        }).catch(error => { if (error !== rollback) throw error; });
        await ready;
        const contender = second.product.update({ where: { id: b.id }, data: { status: 'ACTIVE' } });
        if (action === 'COMMIT') {
          const rejected = expect(contender).rejects.toMatchObject({ code: 'P2002' });
          releaseFirst();
          await leader;
          await rejected;
        } else {
          const pending = contender.then(row => row);
          releaseFirst();
          await leader;
          await pending;
        }
        const active = await prisma.product.findMany({ where: { categoryId, status: 'ACTIVE' } });
        expect(active.map(row => row.id)).toEqual([action === 'COMMIT' ? a.id : b.id]);
      } finally {
        releaseFirst();
        await Promise.all([first.$disconnect(), second.$disconnect()]);
      }
    },
  );
});
