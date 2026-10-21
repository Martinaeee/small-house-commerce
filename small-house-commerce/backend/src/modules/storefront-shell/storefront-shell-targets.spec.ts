import { describe, expect, it, vi } from 'vitest';
import {
  createCurrentLuwagShellDocument,
  type StorefrontShellDocument,
  type StructuredLink,
} from './storefront-shell-document.js';
import { StorefrontShellTargetResolver } from './storefront-shell-targets.js';

const IDS = {
  product: '00000000-0000-7000-8000-000000000301',
  collection: '00000000-0000-7000-8000-000000000302',
  category: '00000000-0000-7000-8000-000000000303',
  childCategory: '00000000-0000-7000-8000-000000000304',
  landing: '00000000-0000-7000-8000-000000000305',
  parentProduct: '00000000-0000-7000-8000-000000000306',
} as const;

type PrismaStub = {
  product: { findMany: ReturnType<typeof vi.fn> };
  collection: { findMany: ReturnType<typeof vi.fn> };
  category: { findMany: ReturnType<typeof vi.fn> };
  productLandingPage: { findMany: ReturnType<typeof vi.fn> };
};

function prismaStub(overrides: Partial<Record<keyof PrismaStub, unknown>> = {}): PrismaStub {
  return {
    product: {
      findMany: vi.fn(async () =>
        overrides.product ?? [{ id: IDS.product, slug: 'chair', status: 'ACTIVE' }],
      ),
    },
    collection: {
      findMany: vi.fn(async () =>
        overrides.collection ?? [{ id: IDS.collection, slug: 'new-arrivals', status: 'ACTIVE' }],
      ),
    },
    category: {
      findMany: vi.fn(async () =>
        overrides.category ?? [
          { id: IDS.category, slug: 'living', status: 'ACTIVE', parentId: null },
        ],
      ),
    },
    productLandingPage: {
      findMany: vi.fn(async () =>
        overrides.productLandingPage ?? [
          {
            id: IDS.landing,
            slug: 'chair-promo',
            status: 'ACTIVE',
            publishedContent: { blocks: [] },
            startAt: null,
            endAt: null,
            product: { status: 'ACTIVE' },
          },
        ],
      ),
    },
  };
}

function baseDocument(): StorefrontShellDocument {
  return createCurrentLuwagShellDocument({
    rootCategories: [{ id: IDS.category, name: 'Living', sortOrder: 10 }],
    navigationCollections: [
      { id: IDS.collection, name: 'New Arrivals', slug: 'new-arrivals', sortOrder: 0 },
    ],
    supportEmail: 'support@luwag.ph',
    supportHours: 'Mon–Sat, 9am–6pm (PHT)',
  });
}

function withHeaderLinks(
  links: Array<{ id: string; label: string; link: StructuredLink }>,
): StorefrontShellDocument {
  const doc = baseDocument();
  return {
    ...doc,
    header: {
      items: links.map((entry) => ({
        id: entry.id,
        kind: 'STRUCTURED_LINK' as const,
        label: entry.label,
        enabled: true,
        link: entry.link,
      })),
    },
  };
}

describe('StorefrontShellTargetResolver', () => {
  it('resolves current slugs in one query per entity type and never trusts stored hrefs', async () => {
    const prisma = prismaStub();
    const resolver = new StorefrontShellTargetResolver(prisma as never);
    const document = withHeaderLinks([
      { id: 'p', label: 'Chair', link: { type: 'PRODUCT', id: IDS.product } },
      { id: 'c', label: 'New', link: { type: 'COLLECTION', id: IDS.collection } },
      { id: 'k', label: 'Living', link: { type: 'CATEGORY', id: IDS.category } },
      { id: 'l', label: 'Promo', link: { type: 'LANDING', id: IDS.landing } },
    ]);

    const resolved = await resolver.resolve(document);

    expect(resolved.headerByItemId.get('p')).toMatchObject({ href: '/products/chair' });
    expect(resolved.headerByItemId.get('c')).toMatchObject({ href: '/collections/new-arrivals' });
    expect(resolved.headerByItemId.get('k')).toMatchObject({ href: '/categories/living' });
    expect(resolved.headerByItemId.get('l')).toMatchObject({ href: '/lp/chair-promo' });
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.collection.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.productLandingPage.findMany).toHaveBeenCalledTimes(1);
  });

  it('collects and resolves direct COLLECTION Header items as collections', async () => {
    const prisma = prismaStub();
    const resolver = new StorefrontShellTargetResolver(prisma as never);
    const base = baseDocument();
    const document: StorefrontShellDocument = {
      ...base,
      header: {
        items: [
          {
            id: 'direct-collection',
            kind: 'COLLECTION',
            targetId: IDS.collection,
            labelOverride: 'New arrivals',
            enabled: true,
          },
        ],
      },
      // Clear default Shop links so no unrelated footer link happens to load
      // the same collection and mask a missing Header collection query.
      footer: {
        ...base.footer,
        columns: base.footer.columns.map((column) =>
          column.kind === 'LINKS' ? { ...column, rows: [] } : column,
        ),
      },
    };

    const resolved = await resolver.resolve(document);

    expect(prisma.collection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [IDS.collection] } } }),
    );
    expect(resolved.headerByItemId.get('direct-collection')).toMatchObject({
      label: 'New arrivals',
      href: '/collections/new-arrivals',
    });
    expect(resolved.unavailableByItemId.has('direct-collection')).toBe(false);
  });

  it('requires a CATEGORY_ROOT target to be ACTIVE and parentless', async () => {
    const prisma = prismaStub({
      category: [
        { id: IDS.childCategory, slug: 'sofas', status: 'ACTIVE', parentId: IDS.category },
      ],
    });
    const resolver = new StorefrontShellTargetResolver(prisma as never);
    const document: StorefrontShellDocument = {
      ...baseDocument(),
      header: {
        items: [
          { id: 'child', kind: 'CATEGORY_ROOT', targetId: IDS.childCategory, labelOverride: 'Sofas', enabled: true },
        ],
      },
    };

    const resolved = await resolver.resolve(document);

    expect(resolved.headerByItemId.has('child')).toBe(false);
    expect(resolved.unavailableByItemId.get('child')).toBe('CATEGORY_NOT_ROOT');
  });

  it('treats a DISABLED product, collection or category as unavailable', async () => {
    const prisma = prismaStub({
      product: [{ id: IDS.product, slug: 'chair', status: 'DISABLED' }],
      collection: [{ id: IDS.collection, slug: 'new-arrivals', status: 'DISABLED' }],
      category: [{ id: IDS.category, slug: 'living', status: 'DISABLED', parentId: null }],
    });
    const resolver = new StorefrontShellTargetResolver(prisma as never);
    const document = withHeaderLinks([
      { id: 'p', label: 'Chair', link: { type: 'PRODUCT', id: IDS.product } },
      { id: 'c', label: 'New', link: { type: 'COLLECTION', id: IDS.collection } },
      { id: 'k', label: 'Living', link: { type: 'CATEGORY', id: IDS.category } },
    ]);

    const resolved = await resolver.resolve(document);

    expect(resolved.unavailableByItemId.get('p')).toBe('TARGET_UNAVAILABLE');
    expect(resolved.unavailableByItemId.get('c')).toBe('TARGET_UNAVAILABLE');
    expect(resolved.unavailableByItemId.get('k')).toBe('TARGET_UNAVAILABLE');
  });

  it('requires a landing page to be published, inside its window and under an active product', async () => {
    const now = new Date('2026-10-13T00:00:00.000Z');
    const cases: Array<[string, Record<string, unknown>]> = [
      ['draft', { status: 'DRAFT' }],
      ['unpublished', { publishedContent: null }],
      ['not-started', { startAt: new Date('2026-11-01T00:00:00.000Z') }],
      ['ended', { endAt: new Date('2026-09-01T00:00:00.000Z') }],
      ['inactive-product', { product: { status: 'DISABLED' } }],
    ];

    for (const [name, override] of cases) {
      const prisma = prismaStub({
        productLandingPage: [
          {
            id: IDS.landing,
            slug: 'chair-promo',
            status: 'ACTIVE',
            publishedContent: { blocks: [] },
            startAt: null,
            endAt: null,
            product: { status: 'ACTIVE' },
            ...override,
          },
        ],
      });
      const resolver = new StorefrontShellTargetResolver(prisma as never, () => now);
      const document = withHeaderLinks([
        { id: 'l', label: 'Promo', link: { type: 'LANDING', id: IDS.landing } },
      ]);

      const resolved = await resolver.resolve(document);

      expect(resolved.unavailableByItemId.get('l'), name).toBe('TARGET_UNAVAILABLE');
    }
  });

  it('accepts a safe internal path and rejects unsafe or non-https external targets', async () => {
    const resolver = new StorefrontShellTargetResolver(prismaStub() as never);
    const document = withHeaderLinks([
      { id: 'ok', label: 'Track', link: { type: 'INTERNAL', path: '/track-order' } },
      { id: 'bad', label: 'Bad', link: { type: 'INTERNAL', path: '//evil.test/x' } },
      { id: 'ext', label: 'Ext', link: { type: 'EXTERNAL', url: 'https://luwag.ph/help' } },
      { id: 'js', label: 'Js', link: { type: 'EXTERNAL', url: 'javascript:alert(1)' } },
    ]);

    const resolved = await resolver.resolve(document);

    expect(resolved.headerByItemId.get('ok')).toMatchObject({ href: '/track-order' });
    expect(resolved.headerByItemId.get('ext')).toMatchObject({ href: 'https://luwag.ph/help' });
    expect(resolved.unavailableByItemId.get('bad')).toBe('UNSAFE_INTERNAL_PATH');
    expect(resolved.unavailableByItemId.get('js')).toBe('UNSAFE_EXTERNAL_URL');
  });

  it('omits a target disabled after publication without dropping neighbouring rows', async () => {
    const active = prismaStub({
      product: [
        { id: IDS.product, slug: 'chair', status: 'ACTIVE' },
        { id: IDS.parentProduct, slug: 'sofa', status: 'ACTIVE' },
      ],
    });
    const resolver = new StorefrontShellTargetResolver(active as never);
    const document = withHeaderLinks([
      { id: 'a', label: 'Chair', link: { type: 'PRODUCT', id: IDS.product } },
      { id: 'b', label: 'Sofa', link: { type: 'PRODUCT', id: IDS.parentProduct } },
    ]);

    const before = await resolver.resolve(document);
    expect(before.headerByItemId.size).toBe(2);

    const disabled = prismaStub({
      product: [
        { id: IDS.product, slug: 'chair', status: 'DISABLED' },
        { id: IDS.parentProduct, slug: 'sofa', status: 'ACTIVE' },
      ],
    });
    const after = await new StorefrontShellTargetResolver(disabled as never).resolve(document);

    expect(after.headerByItemId.has('a')).toBe(false);
    expect(after.headerByItemId.get('b')).toMatchObject({ href: '/products/sofa' });
  });

  it('resolves footer link rows through the same rules', async () => {
    const resolver = new StorefrontShellTargetResolver(prismaStub() as never);
    const doc = baseDocument();
    const document: StorefrontShellDocument = {
      ...doc,
      footer: {
        ...doc.footer,
        columns: [
          {
            id: 'col',
            kind: 'LINKS',
            title: 'Shop',
            rows: [
              { id: 'r1', kind: 'LINK', label: 'Chair', link: { type: 'PRODUCT', id: IDS.product } },
              { id: 'r2', kind: 'TEXT', text: 'Cash on delivery' },
            ],
          },
        ],
      },
    };

    const resolved = await resolver.resolve(document);

    expect(resolved.footerLinkByRowId.get('r1')).toMatchObject({ href: '/products/chair' });
    expect(resolved.footerLinkByRowId.has('r2')).toBe(false);
  });
});
