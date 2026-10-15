import { describe, expect, it } from 'vitest';
import { normaliseLandingContent } from '../catalog/landing/landing-content.js';
import { freezeLegacyLandingContent, parseLegacyBackfillCommand, type LegacyLandingOverrides } from './legacy-migration.js';

const source = () => normaliseLandingContent({
  schemaVersion: 1, seoTitle: 'Parent SEO title', seoDescription: 'Parent metadata',
  blocks: [
    { id: 'hero', type: 'hero', sourceKey: 'hero:parent', props: { title: 'Parent chair', tagline: 'Saved tagline' } },
    { id: 'gallery', type: 'gallery', sourceKey: 'gallery:parent', props: { media: [
      { url: '/uploads/shared.jpg', type: 'IMAGE' },
      { url: '/uploads/variant.jpg', type: 'IMAGE', variantId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
    ] } },
    { id: 'buy', type: 'buy', sourceKey: 'buy:parent', props: {} },
    { id: 'body', type: 'richText', sourceKey: 'description:parent', props: { html: '<p>Saved parent description</p>' } },
  ],
});
const legacy = (overrides: Partial<LegacyLandingOverrides> = {}): LegacyLandingOverrides => ({
  titleOverride: null, imagesOverride: null, seoTitle: null, seoDescription: null,
  promoEnabled: false, promoHeadline: null, promoSubtext: null, startAt: null, endAt: null,
  ...overrides,
});

describe('legacy backfill command safety', () => {
  const database = 'postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public';
  it('requires an explicit database rather than falling back to a shared environment', () => {
    expect(() => parseLegacyBackfillCommand([], undefined)).toThrow();
  });
  it('defaults to dry run and preserves a validated explicit page selection', () => {
    expect(parseLegacyBackfillCommand(['--page-id', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'], database)).toEqual({ apply: false, pageIds: ['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'] });
    expect(() => parseLegacyBackfillCommand(['--page-id', 'invalid'], database)).toThrow();
    expect(() => parseLegacyBackfillCommand(['--unknown'], database)).toThrow();
  });
  it('refuses writes without an exact database confirmation and accepts the confirmed target', () => {
    expect(() => parseLegacyBackfillCommand(['--apply'], database)).toThrow();
    expect(() => parseLegacyBackfillCommand(['--apply', '--confirm-database', 'wrong-database'], database)).toThrow();
    expect(parseLegacyBackfillCommand(['--apply', '--confirm-database', '127.0.0.1:5432/small_house_marketing_dev'], database)).toEqual({ apply: true });
  });
});

describe('legacy landing snapshot conversion', () => {
  it('freezes the old title, promo, SEO and ordered shared images without reordering parent blocks', () => {
    const result = freezeLegacyLandingContent(legacy({ titleOverride: '  Legacy chair  ', promoEnabled: true, promoHeadline: 'Legacy promotion', promoSubtext: 'Saved copy', seoTitle: 'Legacy SEO', seoDescription: 'Legacy description', imagesOverride: [{ url: '/uploads/second.jpg', altText: 'Second first' }, { url: '/uploads/first.jpg' }] }), source(), 'Parent description');
    expect(result.blocks.map(block => block.id)).toEqual(['hero', 'gallery', 'buy', 'body']);
    expect(result.blocks[0]).toMatchObject({ props: { title: 'Legacy chair', tagline: 'Saved tagline', promoHeadline: 'Legacy promotion', promoSubtext: 'Saved copy' } });
    expect(result.blocks[1]).toMatchObject({ props: { media: [
      { url: '/uploads/second.jpg', type: 'IMAGE', altText: 'Second first', variantId: null, optionValueId: null },
      { url: '/uploads/first.jpg', type: 'IMAGE', altText: null, variantId: null, optionValueId: null },
      { url: '/uploads/variant.jpg', type: 'IMAGE', variantId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
    ] } });
    expect(result).toMatchObject({ seoTitle: 'Legacy SEO', seoDescription: 'Legacy description' });
  });

  it('inherits missing visible fields but preserves the actual old metadata fallbacks', () => {
    const parent = source();
    const result = freezeLegacyLandingContent(legacy({ titleOverride: ' ', imagesOverride: [] }), parent, 'Actual parent description');
    expect(result.blocks).toEqual(parent.blocks);
    expect(result.seoTitle).toBe('Parent chair');
    expect(result.seoDescription).toBe('Actual parent description');
  });

  it('keeps a disabled promo hidden and carries the saved schedule without converting it to migration time', () => {
    const result = freezeLegacyLandingContent(legacy({ promoHeadline: 'Hidden draft promo', promoSubtext: 'Hidden', startAt: new Date('2026-10-05T00:00:00+08:00'), endAt: new Date('2026-10-15T23:59:59+08:00') }), source(), null);
    expect(result.blocks[0]).toMatchObject({ props: { promoHeadline: null, promoSubtext: null } });
    expect(result.startAt).toBe('2026-10-04T16:00:00.000Z');
    expect(result.endAt).toBe('2026-10-15T15:59:59.000Z');
  });

  it('never persists unsafe legacy media or bypasses the canonical sanitizer', () => {
    expect(() => freezeLegacyLandingContent(legacy({ imagesOverride: [{ url: 'javascript:alert(1)' }] }), source(), null)).toThrow();
    const parent = source();
    const body = parent.blocks.find(block => block.type === 'richText')!;
    if (body.type === 'richText') body.props.html = '<script>alert(1)</script><p onclick="alert(1)">Safe</p>';
    expect(freezeLegacyLandingContent(legacy(), parent, null).blocks.at(-1)).toMatchObject({ props: { html: '<p>Safe</p>' } });
  });

  it('leaves the parent document unchanged and bounds only the old unbounded metadata fallback', () => {
    const parent = source(); const before = structuredClone(parent);
    const result = freezeLegacyLandingContent(legacy({ titleOverride: 'Own title' }), parent, 'x'.repeat(500));
    expect(parent).toEqual(before);
    expect(result.seoDescription).toBe('x'.repeat(300));
    expect(result.blocks.at(-1)).toEqual(before.blocks.at(-1));
  });
});
