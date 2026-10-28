import { describe, expect, it } from 'vitest';
import {
  createCurrentLuwagShellDocument,
  type FooterColumn,
  type HeaderItem,
  type StorefrontShellDocument,
} from './storefront-shell-document.js';
import {
  publicProjection,
  validateShellForPublish,
  type ShellValidationContext,
} from './storefront-shell-validation.js';

const IDS = {
  category: '00000000-0000-7000-8000-000000000401',
  collection: '00000000-0000-7000-8000-000000000402',
} as const;

function document(): StorefrontShellDocument {
  return createCurrentLuwagShellDocument({
    rootCategories: [{ id: IDS.category, name: 'Living', sortOrder: 10 }],
    navigationCollections: [
      { id: IDS.collection, name: 'New Arrivals', slug: 'new-arrivals', sortOrder: 0 },
    ],
    supportEmail: 'support@luwag.ph',
    supportHours: 'Mon–Sat, 9am–6pm (PHT)',
  });
}

/** Everything resolvable and durable unless a test overrides it. */
function context(
  doc: StorefrontShellDocument,
  overrides: Partial<ShellValidationContext> = {},
): ShellValidationContext {
  const header = new Map<string, { href: string | null; categoryId: string | null; reason: string | null }>();
  for (const item of doc.header.items) {
    if (!item.enabled) continue;
    if (item.kind === 'CATEGORY_ROOT') {
      header.set(item.id, { href: null, categoryId: item.targetId, reason: null });
      continue;
    }
    if (item.kind === 'STRUCTURED_LINK') {
      header.set(item.id, {
        href: item.link.type === 'INTERNAL' ? item.link.path : '/collections/new-arrivals',
        categoryId: null,
        reason: null,
      });
      continue;
    }
    header.set(item.id, { href: '/collections/new-arrivals', categoryId: null, reason: null });
  }

  const row = new Map<string, { available: true; href: string }>();
  for (const column of doc.footer.columns) {
    if (column.kind === 'LINKS') {
      for (const entry of column.rows) {
        if (entry.kind === 'LINK') row.set(entry.id, { available: true, href: '/collections/new-arrivals' });
      }
    } else {
      row.set(`${column.id}:trackOrder`, { available: true, href: '/track-order' });
    }
  }

  return {
    header,
    row,
    assets: { horizontalLogo: null, squareMark: null },
    ...overrides,
  };
}

function projectionContext(doc: StorefrontShellDocument) {
  const base = context(doc);
  return {
    header: base.header,
    row: base.row,
    horizontalLogo: null,
    squareMark: null,
  };
}

describe('validateShellForPublish', () => {
  it('accepts the migrated current-LUWAG document', () => {
    const doc = document();
    expect(validateShellForPublish(doc, context(doc))).toEqual([]);
  });

  it('blocks publication when no Header item is enabled', () => {
    const doc = document();
    const disabled = { ...doc, header: { items: doc.header.items.map((item) => ({ ...item, enabled: false })) } };
    const issues = validateShellForPublish(disabled, context(disabled));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_NO_ENABLED_HEADER_ITEM', path: ['header', 'items'] }),
    );
  });

  it('blocks more than eight enabled rows even though the draft may hold more', () => {
    const doc = document();
    const items: HeaderItem[] = Array.from({ length: 9 }, (_, index) => ({
      id: `row-${index}`,
      kind: 'STRUCTURED_LINK',
      label: `Link ${index}`,
      enabled: true,
      link: { type: 'INTERNAL', path: '/track-order' },
    }));
    const nine = { ...doc, header: { items } };
    const issues = validateShellForPublish(nine, context(nine));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_TOO_MANY_ENABLED_HEADER_ITEMS', path: ['header', 'items'] }),
    );
  });

  it('does not count disabled rows against the eight-visible limit', () => {
    const doc = document();
    const items: HeaderItem[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `enabled-${index}`,
        kind: 'STRUCTURED_LINK' as const,
        label: `Link ${index}`,
        enabled: true,
        link: { type: 'INTERNAL' as const, path: '/track-order' },
      })),
      {
        id: 'hidden',
        kind: 'STRUCTURED_LINK' as const,
        label: 'Hidden',
        enabled: false,
        link: { type: 'INTERNAL' as const, path: '/track-order' },
      },
    ];
    const mixed = { ...doc, header: { items } };

    expect(validateShellForPublish(mixed, context(mixed))).toEqual([]);
  });

  it('blocks duplicate stable ids', () => {
    const doc = document();
    const first = doc.header.items[0];
    const duplicated = { ...doc, header: { items: [first, { ...first }] } };
    const issues = validateShellForPublish(duplicated, context(duplicated));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_DUPLICATE_ID', path: ['header', 'items', first.id] }),
    );
  });

  it('blocks empty and over-limit labels with an item-addressable path', () => {
    const doc = document();
    const items: HeaderItem[] = [
      { id: 'empty', kind: 'STRUCTURED_LINK', label: '', enabled: true, link: { type: 'INTERNAL', path: '/track-order' } },
      { id: 'long', kind: 'STRUCTURED_LINK', label: 'x'.repeat(41), enabled: true, link: { type: 'INTERNAL', path: '/track-order' } },
    ];
    const labelled = { ...doc, header: { items } };
    const issues = validateShellForPublish(labelled, context(labelled));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_EMPTY_LABEL', path: ['header', 'items', 'empty', 'label'] }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_LABEL_TOO_LONG', path: ['header', 'items', 'long', 'label'] }),
    );
  });

  it('blocks an unavailable referenced entity with an item-addressable path', () => {
    const doc = document();
    const item = doc.header.items[0];
    const base = context(doc);
    const issues = validateShellForPublish(doc, {
      ...base,
      header: new Map([
        [item.id, { href: null, categoryId: null, reason: 'TARGET_UNAVAILABLE' }],
      ]),
    });

    expect(issues).toContainEqual({
      code: 'TARGET_UNAVAILABLE',
      path: ['header', 'items', item.id],
      itemId: item.id,
      message: expect.any(String),
    });
  });

  it('blocks more than five Footer columns', () => {
    const doc = document();
    const columns: FooterColumn[] = [
      ...doc.footer.columns,
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `extra-${index}`,
        kind: 'LINKS' as const,
        title: `Extra ${index}`,
        rows: [],
      })),
    ];
    const wide = { ...doc, footer: { ...doc.footer, columns } };
    const issues = validateShellForPublish(wide, context(wide));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SHELL_TOO_MANY_FOOTER_COLUMNS', path: ['footer', 'columns'] }),
    );
  });

  it('allows a footer without a CONTACT column but still blocks duplicates', () => {
    const doc = document();
    const noContact: FooterColumn[] = [{ id: 'links', kind: 'LINKS', title: 'Shop', rows: [] }];
    const without = { ...doc, footer: { ...doc.footer, columns: noContact } };

    expect(validateShellForPublish(without, context(without))).not.toContainEqual(
      expect.objectContaining({ code: 'SHELL_CONTACT_COLUMN_MISSING' }),
    );

    const contact = doc.footer.columns.find((column) => column.kind === 'CONTACT')!;
    const duplicated = { ...doc, footer: { ...doc.footer, columns: [...doc.footer.columns, { ...contact, id: 'contact-2' }] } };

    expect(validateShellForPublish(duplicated, context(duplicated))).toContainEqual(
      expect.objectContaining({ code: 'SHELL_CONTACT_COLUMN_DUPLICATED' }),
    );
  });

  it('rejects an invalid support email', () => {
    const doc = document();
    const columns = doc.footer.columns.map((column) =>
      column.kind === 'CONTACT' ? { ...column, supportEmail: 'not-an-email' } : column,
    );
    const bad = { ...doc, footer: { ...doc.footer, columns } };
    const issues = validateShellForPublish(bad, context(bad));

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'SHELL_INVALID_SUPPORT_EMAIL',
        path: [
          'footer',
          'columns',
          doc.footer.columns.find((column) => column.kind === 'CONTACT')!.id,
          'supportEmail',
        ],
      }),
    );
  });

  it('blocks a brand asset that is missing, the wrong kind or not durable', () => {
    const doc = document();
    const assetId = '00000000-0000-7000-8000-000000000501';
    const withLogo: StorefrontShellDocument = {
      ...doc,
      brand: { ...doc.brand, horizontalLogo: { assetId } },
    };
    const base = context(withLogo);

    expect(
      validateShellForPublish(withLogo, { ...base, assets: { horizontalLogo: null, squareMark: null } }),
    ).toContainEqual(expect.objectContaining({ code: 'SHELL_ASSET_MISSING', path: ['brand', 'horizontalLogo'] }));

    expect(
      validateShellForPublish(withLogo, {
        ...base,
        assets: { horizontalLogo: { id: assetId, kind: 'SQUARE', durable: true }, squareMark: null },
      }),
    ).toContainEqual(expect.objectContaining({ code: 'SHELL_ASSET_WRONG_KIND', path: ['brand', 'horizontalLogo'] }));

    expect(
      validateShellForPublish(withLogo, {
        ...base,
        assets: { horizontalLogo: { id: assetId, kind: 'HORIZONTAL', durable: false }, squareMark: null },
      }),
    ).toContainEqual(expect.objectContaining({ code: 'SHELL_ASSET_NOT_DURABLE', path: ['brand', 'horizontalLogo'] }));
  });

  it('carries the Task 1 theme issues into publication', () => {
    const doc = document();
    const lowContrast = { ...doc, theme: { ...doc.theme, text: '#cccccc' } };
    const issues = validateShellForPublish(lowContrast, context(lowContrast));

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'THEME_TEXT_BACKGROUND_CONTRAST', path: ['theme', 'text'] }),
    );
  });
});

describe('publicProjection', () => {
  it('omits unavailable targets while keeping every valid neighbour', () => {
    const doc = document();
    const [first, second] = doc.header.items;
    const twoItemDoc: StorefrontShellDocument = {
      ...doc,
      header: {
        items: [
          { id: first.id, kind: 'STRUCTURED_LINK', label: 'First', enabled: true, link: { type: 'INTERNAL', path: '/track-order' } },
          { id: second.id, kind: 'STRUCTURED_LINK', label: 'Second', enabled: true, link: { type: 'INTERNAL', path: '/track-order' } },
        ],
      },
    };

    const projection = publicProjection(twoItemDoc, {
      header: new Map([[second.id, { href: '/track-order', categoryId: null, reason: null }]]),
      row: context(twoItemDoc).row,
      horizontalLogo: null,
      squareMark: null,
    });

    expect(projection.header.items.map((item) => item.id)).toEqual([second.id]);
    expect(projection.header.items[0]).toMatchObject({ label: 'Second', href: '/track-order' });
  });

  it('omits only an unavailable Track Order target and retains the Contact column', () => {
    const doc = document();
    const contact = doc.footer.columns.find((column) => column.kind === 'CONTACT')!;
    const projection = projectionContext(doc);
    const row = new Map(projection.row);
    row.set(`${contact.id}:trackOrder`, {
      available: false,
      reason: 'TARGET_UNAVAILABLE',
    });

    const result = publicProjection(doc, { ...projection, row });
    const projectedContact = result.footer.columns.find(
      (column) => column.kind === 'CONTACT',
    );

    expect(projectedContact).toMatchObject({
      kind: 'CONTACT',
      supportEmail: contact.supportEmail,
      supportHours: contact.supportHours,
      trackOrderLabel: contact.trackOrderLabel,
      trackOrderHref: null,
    });
    expect(projectedContact).not.toHaveProperty('codText');
  });

  it('never leaks draft-only, audit or storage fields', () => {
    const doc = document();
    const projection = publicProjection(doc, projectionContext(doc));
    const serialized = JSON.stringify(projection);

    expect(serialized).not.toContain('draftDocument');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('updatedByUserId');
    expect(serialized).not.toContain('publishedByUserId');
  });
});
