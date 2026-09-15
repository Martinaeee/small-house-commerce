import { describe, expect, it } from 'vitest';
import { HomepageSectionType } from '../../../generated/prisma/client.js';
import {
  homepagePayloadSchemas,
  saveHomepageSectionsSchema,
  setHomepageProductsSchema,
} from './homepage-section.dto.js';

describe('homepage payload schemas', () => {
  it('accepts a valid payload for every section type', () => {
    const cases: Array<[HomepageSectionType, unknown]> = [
      [
        HomepageSectionType.HERO,
        {
          desktopImage: 'https://cdn.example.com/a.jpg',
          ctaPrimaryText: 'Shop Small-Space Picks',
          ctaPrimaryLink: '/collections',
          ctaSecondaryLink: '#solutions',
        },
      ],
      [HomepageSectionType.USP, { items: [{ icon: 'truck', label: 'Fast', sub: 'PH wide' }] }],
      [HomepageSectionType.CATEGORY_TILES, { categoryIds: [] }],
      [HomepageSectionType.PRODUCT_GRID, { columns: 4 }],
      [
        HomepageSectionType.SOLUTIONS,
        { items: [{ title: 'Small Bedroom', blurb: 'Compact beds', link: '/collections/x' }] },
      ],
      [
        HomepageSectionType.PRODUCT_STORY,
        { heading: 'Made for rentals', ctaLink: 'https://luwag.ph/products/x' },
      ],
      [HomepageSectionType.ROOM_INSPIRATION, { imageUrl: 'https://cdn.example.com/r.jpg' }],
      [
        HomepageSectionType.UGC,
        { entries: [{ name: 'Maria', comment: 'Love it', location: 'Cebu' }] },
      ],
      [HomepageSectionType.BRAND_STORY, { heading: 'Our Story', bullets: ['a', 'b'] }],
      [HomepageSectionType.CONFIDENCE, { heading: 'Shop with confidence' }],
    ];

    for (const [type, payload] of cases) {
      expect(homepagePayloadSchemas[type].safeParse(payload).success).toBe(true);
    }
  });

  it('accepts an empty object for every payload (empty falls back to defaults)', () => {
    for (const schema of Object.values(homepagePayloadSchemas)) {
      expect(schema.safeParse({}).success).toBe(true);
    }
  });

  it('rejects non-https / javascript URLs and in-app links that start elsewhere', () => {
    const hero = homepagePayloadSchemas[HomepageSectionType.HERO];
    expect(hero.safeParse({ ctaPrimaryLink: 'javascript:alert(1)' }).success).toBe(false);
    expect(hero.safeParse({ ctaPrimaryLink: 'http://insecure.example.com' }).success).toBe(false);
    expect(hero.safeParse({ desktopImage: 'not-a-url' }).success).toBe(false);
  });

  it('rejects over-length text', () => {
    const hero = homepagePayloadSchemas[HomepageSectionType.HERO];
    expect(hero.safeParse({ ctaPrimaryText: 'x'.repeat(121) }).success).toBe(false);
    const brand = homepagePayloadSchemas[HomepageSectionType.BRAND_STORY];
    expect(brand.safeParse({ body: 'x'.repeat(3001) }).success).toBe(false);
  });

  it('enforces item count limits', () => {
    expect(
      homepagePayloadSchemas[HomepageSectionType.USP]
        .safeParse({ items: Array.from({ length: 5 }, () => ({ label: 'x' })) }).success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.CATEGORY_TILES]
        .safeParse({ categoryIds: Array.from({ length: 7 }, () => crypto.randomUUID()) }).success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.SOLUTIONS]
        .safeParse({ items: Array.from({ length: 7 }, (_, i) => ({ title: `s${i}`, link: '/x' })) })
        .success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.UGC]
        .safeParse({ entries: Array.from({ length: 7 }, () => ({ name: 'n', comment: 'c' })) })
        .success,
    ).toBe(false);
  });

  it('rejects unknown USP icons and non-uuid category/product ids', () => {
    expect(
      homepagePayloadSchemas[HomepageSectionType.USP].safeParse({ items: [{ icon: 'star', label: 'x' }] })
        .success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.CATEGORY_TILES].safeParse({ categoryIds: ['nope'] })
        .success,
    ).toBe(false);
    expect(
      homepagePayloadSchemas[HomepageSectionType.PRODUCT_STORY].safeParse({ productId: 'nope' })
        .success,
    ).toBe(false);
  });

  it('validates the whole-section save body', () => {
    const ok = saveHomepageSectionsSchema.safeParse({
      sections: [{ enabled: true, sortOrder: 0, type: HomepageSectionType.HERO }],
    });
    expect(ok.success).toBe(true);
    expect(
      saveHomepageSectionsSchema.safeParse({ sections: [{ enabled: true, sortOrder: -1 }] }).success,
    ).toBe(false);
    expect(
      saveHomepageSectionsSchema.safeParse({
        sections: Array.from({ length: 21 }, () => ({ enabled: true, sortOrder: 0 })),
      }).success,
    ).toBe(false);
  });

  it('validates the section products body (badge ≤ 20, max 24 rows)', () => {
    const id = crypto.randomUUID();
    expect(
      setHomepageProductsSchema.safeParse({ rows: [{ productId: id, sortOrder: 0, badge: '新品' }] })
        .success,
    ).toBe(true);
    expect(
      setHomepageProductsSchema.safeParse({ rows: [{ productId: id, sortOrder: 0, badge: 'x'.repeat(21) }] })
        .success,
    ).toBe(false);
    expect(
      setHomepageProductsSchema.safeParse({
        rows: Array.from({ length: 25 }, () => ({ productId: crypto.randomUUID(), sortOrder: 0 })),
      }).success,
    ).toBe(false);
  });
});
