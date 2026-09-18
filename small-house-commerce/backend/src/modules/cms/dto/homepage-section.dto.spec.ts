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

  it('rejects protocol-relative links and keeps valid in-app / https links working', () => {
    const hero = homepagePayloadSchemas[HomepageSectionType.HERO];
    expect(hero.safeParse({ ctaPrimaryLink: '//evil.com/x' }).success).toBe(false);
    expect(hero.safeParse({ ctaPrimaryLink: '/collections/x' }).success).toBe(true);
    expect(hero.safeParse({ ctaPrimaryLink: '#solutions' }).success).toBe(true);
    expect(hero.safeParse({ ctaPrimaryLink: 'https://luwag.ph/x' }).success).toBe(true);
    const solutions = homepagePayloadSchemas[HomepageSectionType.SOLUTIONS];
    expect(
      solutions.safeParse({ items: [{ title: 't', link: '//evil.com/x' }] }).success,
    ).toBe(false);
    expect(
      solutions.safeParse({ items: [{ title: 't', link: '/collections/x' }] }).success,
    ).toBe(true);
  });

  it('accepts https/http and site-relative media URLs, rejects dangerous ones', () => {
    const hero = homepagePayloadSchemas[HomepageSectionType.HERO];
    // Local-disk uploads return site-relative /uploads paths; plain http
    // absolute links are also legitimate (IP-era deployments). Dangerous
    // schemes and protocol-relative URLs stay rejected.
    expect(hero.safeParse({ desktopImage: 'http://example.com/a.jpg' }).success).toBe(true);
    expect(hero.safeParse({ desktopImage: '/uploads/catalog/2026/a.jpg' }).success).toBe(true);
    expect(hero.safeParse({ desktopImage: 'javascript:alert(1)' }).success).toBe(false);
    expect(hero.safeParse({ desktopImage: '//evil.example.com/a.jpg' }).success).toBe(false);
    expect(hero.safeParse({ desktopImage: 'https://cdn.example.com/a.jpg' }).success).toBe(true);
    expect(hero.safeParse({ desktopImage: 'not-a-url' }).success).toBe(false);
    const story = homepagePayloadSchemas[HomepageSectionType.PRODUCT_STORY];
    expect(story.safeParse({ imageUrl: '/uploads/catalog/2026/b.jpg' }).success).toBe(true);
    expect(story.safeParse({ imageUrl: 'https://cdn.example.com/a.jpg' }).success).toBe(true);
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

  it('accepts ROOM_INSPIRATION scenes with hotspots and keeps legacy fields', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const result = schema.safeParse({
      heading: 'Shop the look',
      scenes: [
        {
          id: 'a1b2c3d4',
          imageUrl: 'https://cdn.example.com/room-1.jpg',
          alt: '马尼拉公寓客厅',
          hotspots: [
            { productId: crypto.randomUUID(), xPct: 34.2, yPct: 57.8 },
            { productId: crypto.randomUUID(), xPct: 3, yPct: 97 },
          ],
        },
        {
          id: 'b2c3d4e5',
          imageUrl: 'https://cdn.example.com/room-2.jpg',
          hotspots: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed room scenes', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const baseHotspot = { productId: crypto.randomUUID(), xPct: 10, yPct: 10 };

    expect(schema.safeParse({ scenes: [{ id: 'BAD-ID', imageUrl: 'https://x.io/a.jpg', hotspots: [] }] }).success).toBe(false);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: 'http://x.io/a.jpg', hotspots: [] }] }).success).toBe(true);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: '/uploads/catalog/2026/c.jpg', hotspots: [] }] }).success).toBe(true);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ ...baseHotspot, xPct: 101 }] }] }).success).toBe(false);
    expect(schema.safeParse({ scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ ...baseHotspot, yPct: -0.1 }] }] }).success).toBe(false);
    expect(
      schema.safeParse({
        scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [baseHotspot, baseHotspot] }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        scenes: [{ id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ ...baseHotspot, productId: 'not-a-uuid' }] }],
      }).success,
    ).toBe(false);
  });

  it('enforces room scene/hotspot caps but allows the same product across scenes', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const pid = crypto.randomUUID();
    expect(
      schema.safeParse({
        scenes: Array.from({ length: 6 }, () => ({
          id: 'abcdefgh',
          imageUrl: 'https://x.io/a.jpg',
          hotspots: [],
        })),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        scenes: [
          {
            id: 'abcdefgh',
            imageUrl: 'https://x.io/a.jpg',
            hotspots: Array.from({ length: 9 }, () => ({ productId: crypto.randomUUID(), xPct: 1, yPct: 1 })),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        scenes: [
          { id: 'abcdefgh', imageUrl: 'https://x.io/a.jpg', hotspots: [{ productId: pid, xPct: 1, yPct: 1 }] },
          { id: 'ijklmnop', imageUrl: 'https://x.io/b.jpg', hotspots: [{ productId: pid, xPct: 2, yPct: 2 }] },
        ],
      }).success,
    ).toBe(true);
  });

  it('pins exact room-scene boundaries: 0/100 coords, 8/16 scene ids, alt 120, finite numbers', () => {
    const schema = homepagePayloadSchemas[HomepageSectionType.ROOM_INSPIRATION];
    const pid = crypto.randomUUID();
    const scene = (over: Record<string, unknown>) => ({
      scenes: [
        {
          id: 'abcdefgh',
          imageUrl: 'https://x.io/a.jpg',
          hotspots: [{ productId: pid, xPct: 0, yPct: 100 }],
          ...over,
        },
      ],
    });

    // Coordinate endpoints are inclusive; non-finite numbers never pass.
    expect(schema.safeParse(scene({})).success).toBe(true);
    expect(schema.safeParse(scene({ hotspots: [{ productId: pid, xPct: Number.NaN, yPct: 1 }] })).success).toBe(false);
    expect(schema.safeParse(scene({ hotspots: [{ productId: pid, xPct: Number.POSITIVE_INFINITY, yPct: 1 }] })).success).toBe(false);

    // Scene id: exactly 8–16 lowercase alphanumerics.
    expect(schema.safeParse({ scenes: [{ id: 'a1b2c3d', imageUrl: 'https://x.io/a.jpg', hotspots: [] }] }).success).toBe(false);
    expect(schema.safeParse({ scenes: [{ id: 'a1b2c3d4', imageUrl: 'https://x.io/a.jpg', hotspots: [] }] }).success).toBe(true);
    expect(schema.safeParse({ scenes: [{ id: 'a1b2c3d4e5f6g7h8', imageUrl: 'https://x.io/a.jpg', hotspots: [] }] }).success).toBe(true);
    expect(schema.safeParse({ scenes: [{ id: 'a1b2c3d4e5f6g7h89', imageUrl: 'https://x.io/a.jpg', hotspots: [] }] }).success).toBe(false);

    // Alt caps at 120 chars.
    expect(schema.safeParse(scene({ alt: 'x'.repeat(120) })).success).toBe(true);
    expect(schema.safeParse(scene({ alt: 'x'.repeat(121) })).success).toBe(false);
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
