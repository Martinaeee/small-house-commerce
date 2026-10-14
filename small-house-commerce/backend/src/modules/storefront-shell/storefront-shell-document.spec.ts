import { describe, expect, it } from 'vitest';
import {
  createCurrentLuwagShellDocument,
  normalizeStorefrontShellDocument,
  storefrontShellDocumentSchema,
  type StorefrontShellDocument,
} from './storefront-shell-document.js';
import { themeFixtures } from './storefront-shell-theme-fixtures.js';

const [currentLuwag] = themeFixtures;

function validDocument(): StorefrontShellDocument {
  return createCurrentLuwagShellDocument({
    rootCategories: [
      { id: '00000000-0000-7000-8000-000000000101', name: 'Living', sortOrder: 10 },
      { id: '00000000-0000-7000-8000-000000000102', name: 'Bedroom', sortOrder: 20 },
    ],
    navigationCollections: [
      { id: '00000000-0000-7000-8000-000000000201', name: 'New Arrivals', slug: 'new-arrivals', sortOrder: 0 },
      { id: '00000000-0000-7000-8000-000000000202', name: 'Solutions', slug: 'small-space-solutions', sortOrder: 50 },
      { id: '00000000-0000-7000-8000-000000000203', name: 'Best Sellers', slug: 'best-sellers', sortOrder: 60 },
    ],
    supportEmail: 'support@luwag.ph',
    supportHours: 'Mon–Sat, 9am–6pm (PHT)',
  });
}

describe('storefrontShellDocumentSchema', () => {
  it('accepts a complete current-LUWAG document', () => {
    expect(storefrontShellDocumentSchema.parse(validDocument()).schemaVersion).toBe(1);
  });

  it('rejects a CSS fragment smuggled into a theme color', () => {
    const doc = validDocument();
    expect(() =>
      storefrontShellDocumentSchema.parse({
        ...doc,
        theme: { ...doc.theme, primary: 'red;--x:1' },
      }),
    ).toThrow();
  });

  it('rejects a remote font URL in a font preset slot', () => {
    const doc = validDocument();
    expect(() =>
      storefrontShellDocumentSchema.parse({
        ...doc,
        theme: { ...doc.theme, headingFont: 'https://fonts.example/x' },
      }),
    ).toThrow();
  });

  it('rejects a protocol-relative internal path', () => {
    const doc = validDocument();
    const item = doc.header.items[0];
    expect(() =>
      storefrontShellDocumentSchema.parse({
        ...doc,
        header: {
          items: [
            {
              id: item.id,
              kind: 'STRUCTURED_LINK',
              label: 'Bad',
              enabled: true,
              link: { type: 'INTERNAL', path: '//evil.test/x' },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it('rejects an external link that is not credential-free https', () => {
    const doc = validDocument();
    const item = doc.header.items[0];
    for (const url of [
      'http://luwag.ph/x',
      'javascript:alert(1)',
      'https://user:pass@luwag.ph/x',
    ]) {
      expect(() =>
        storefrontShellDocumentSchema.parse({
          ...doc,
          header: {
            items: [
              {
                id: item.id,
                kind: 'STRUCTURED_LINK',
                label: 'Bad',
                enabled: true,
                link: { type: 'EXTERNAL', url },
              },
            ],
          },
        }),
      ).toThrow();
    }
  });

  it('rejects unknown keys instead of silently accepting them', () => {
    const doc = validDocument();
    expect(() =>
      storefrontShellDocumentSchema.parse({
        ...doc,
        theme: { ...doc.theme, derivedTheme: { primaryDark: '#000000' } },
      }),
    ).toThrow();
  });
});

describe('normalizeStorefrontShellDocument', () => {
  it('trims strings and lowercases hex values while preserving ids and order', () => {
    const doc = validDocument();
    const normalized = normalizeStorefrontShellDocument({
      ...doc,
      brand: { ...doc.brand, brandName: '  LUWAG  ' },
      theme: { ...doc.theme, primary: '#C9A77B' },
    });

    expect(normalized.brand.brandName).toBe('LUWAG');
    expect(normalized.theme.primary).toBe('#c9a77b');
    expect(normalized.header.items.map((item) => item.id)).toEqual(
      doc.header.items.map((item) => item.id),
    );
  });

  it('keeps an incomplete empty label in a draft rather than dropping the row', () => {
    const doc = validDocument();
    const normalized = normalizeStorefrontShellDocument({
      ...doc,
      header: {
        items: [
          { id: 'row-1', kind: 'COLLECTION', targetId: doc.header.items[0].id, labelOverride: '', enabled: true },
        ],
      },
    });

    expect(normalized.header.items).toHaveLength(1);
    expect(normalized.header.items[0]).toMatchObject({ labelOverride: '' });
  });

  it('does not silently cap an over-limit shape', () => {
    const doc = validDocument();
    expect(() =>
      normalizeStorefrontShellDocument({
        ...doc,
        footer: {
          ...doc.footer,
          columns: Array.from({ length: 5 }, (_, index) => ({
            id: `column-${index}`,
            kind: 'LINKS' as const,
            title: `Column ${index}`,
            rows: [],
          })),
        },
      }),
    ).toThrow();
  });
});

describe('createCurrentLuwagShellDocument', () => {
  it('emits the legacy Header order and the exact current LUWAG theme', () => {
    const doc = validDocument();
    const labels = doc.header.items.map((item) =>
      item.kind === 'CATEGORY_ROOT' || item.kind === 'COLLECTION' ? item.labelOverride : item.label,
    );

    expect(labels).toEqual(['New Arrivals', 'Living', 'Bedroom', 'Solutions', 'Best Sellers']);
    expect(doc.theme).toEqual(currentLuwag.source);
    expect(doc.brand.horizontalLogo).toBeNull();
    expect(doc.brand.squareMark).toBeNull();
  });

  it('keeps the three legacy collection links after the category roots', () => {
    const doc = validDocument();
    const links = doc.header.items.filter((item) => item.kind === 'STRUCTURED_LINK');

    expect(links.map((item) => (item.kind === 'STRUCTURED_LINK' ? item.link : null))).toEqual([
      { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000201' },
      { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000202' },
      { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000203' },
    ]);
  });

  it('imports the current support contact values into the single CONTACT column', () => {
    const doc = validDocument();
    const contact = doc.footer.columns.filter((column) => column.kind === 'CONTACT');

    expect(contact).toHaveLength(1);
    expect(contact[0]).toMatchObject({
      supportEmail: 'support@luwag.ph',
      supportHours: 'Mon–Sat, 9am–6pm (PHT)',
      codText: 'Cash on Delivery nationwide',
      trackOrderLabel: 'Track Order',
      trackOrderLink: { type: 'INTERNAL', path: '/track-order' },
    });
  });

  it('reproduces the current Footer brand copy and a year-free copyright', () => {
    const doc = validDocument();

    expect(doc.footer.tagline).toBe('Small-space furniture, made roomy');
    expect(doc.footer.description).toBe(
      'Furniture for Filipino condos and rentals. Cash on delivery, nationwide.',
    );
    expect(doc.footer.copyrightBrand).toBe('LUWAG Living');
    expect(JSON.stringify(doc)).not.toContain(String(new Date().getFullYear()));
  });

  it('lists the active NAVIGATION collections in the Shop column', () => {
    const doc = validDocument();
    const shop = doc.footer.columns.find(
      (column) => column.kind === 'LINKS' && column.title === 'Shop',
    );

    expect(shop?.kind).toBe('LINKS');
    expect(shop && shop.kind === 'LINKS' ? shop.rows : []).toEqual([
      {
        id: '00000000-0000-7000-8000-000000000201',
        kind: 'LINK',
        label: 'New Arrivals',
        link: { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000201' },
      },
      {
        id: '00000000-0000-7000-8000-000000000202',
        kind: 'LINK',
        label: 'Solutions',
        link: { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000202' },
      },
      {
        id: '00000000-0000-7000-8000-000000000203',
        kind: 'LINK',
        label: 'Best Sellers',
        link: { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000203' },
      },
    ]);
  });
});
