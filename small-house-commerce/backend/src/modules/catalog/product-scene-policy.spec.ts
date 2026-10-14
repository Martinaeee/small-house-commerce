import { describe, expect, it } from 'vitest';
import { mediaWriteSchema } from './dto/catalog-graph.dto.js';
import { updateProductSchema } from './dto/product.dto.js';
import {
  assertSceneMedia,
  prepareLegacySceneImages,
  resolveSceneFlag,
  type SceneMediaRow,
} from './product-scene-policy.js';

const media = { clientKey: 'scene-image', url: '/uploads/scene.webp' };

const shared: SceneMediaRow = {
  id: 'old', productId: 'product', optionValueId: null, variantId: null,
  url: '/uploads/shared.webp', type: 'IMAGE', isScene: true,
};

describe('scene flag inheritance', () => {
  it.each([
    ['same scope omission', { ...shared, isScene: undefined }, true],
    ['URL edit omission', { ...shared, url: '/uploads/edited.webp', isScene: undefined }, true],
    ['explicit clear', { ...shared, isScene: false }, false],
    ['explicit set', { ...shared, isScene: true }, true],
    ['different owner', { ...shared, productId: 'other', isScene: undefined }, false],
    ['variant scope move', { ...shared, variantId: 'variant', isScene: undefined }, false],
    ['value scope move', { ...shared, optionValueId: 'value', isScene: undefined }, false],
    ['convert to video', { ...shared, type: 'VIDEO', isScene: undefined }, false],
  ] satisfies Array<[string, SceneMediaRow, boolean]>)('%s', (_name, next, want) => {
    expect(resolveSceneFlag(shared, next)).toBe(want);
  });

  it('does not infer a scene for a new image', () => {
    expect(resolveSceneFlag(undefined, { ...shared, isScene: undefined })).toBe(false);
  });

  it('accepts an explicit scene on a new image', () => {
    expect(resolveSceneFlag(undefined, shared)).toBe(true);
  });

  it('rejects an explicit scene on video', () => {
    expect(() => resolveSceneFlag(shared, { ...shared, type: 'VIDEO' })).toThrow(/scene.*image/i);
  });
});

describe('scene scope uniqueness', () => {
  it('permits one scene in each product/value/variant scope', () => {
    expect(() => assertSceneMedia([
      shared,
      { ...shared, id: 'value', optionValueId: 'value' },
      { ...shared, id: 'variant', variantId: 'variant' },
      { ...shared, id: 'other-product', productId: 'other' },
    ])).not.toThrow();
  });

  it.each([
    ['shared', null, null],
    ['option value', 'value', null],
    ['variant', null, 'variant'],
  ])('refuses duplicate scenes in a %s scope', (_name, optionValueId, variantId) => {
    const row = { ...shared, optionValueId, variantId };
    expect(() => assertSceneMedia([row, { ...row, id: 'other', url: '/other.webp' }])).toThrow(/scene/i);
  });

  it('allows many unmarked images in the same scope', () => {
    expect(() => assertSceneMedia([
      shared, { ...shared, id: 'other', isScene: false },
      { ...shared, id: 'third', isScene: undefined },
    ])).not.toThrow();
  });

  it('refuses a marked video even without a uniqueness conflict', () => {
    expect(() => assertSceneMedia([{ ...shared, type: 'VIDEO' }])).toThrow(/scene.*image/i);
  });
});

describe('legacy scene metadata matching', () => {
  it('preserves omitted flags by URL/type after a reorder', () => {
    const result = prepareLegacySceneImages([shared], [
      { url: '/uploads/new.webp', type: 'IMAGE', sortOrder: 0 },
      { url: shared.url, type: 'IMAGE', sortOrder: 1 },
    ]);
    expect(result.map(row => row.isScene)).toEqual([false, true]);
    expect(result.map(row => row.sortOrder)).toEqual([0, 1]);
  });

  it('uses an explicit clear rather than inherited metadata', () => {
    expect(prepareLegacySceneImages([shared], [
      { url: shared.url, type: 'IMAGE', sortOrder: 0, isScene: false },
    ])[0].isScene).toBe(false);
  });

  it('sets an explicit scene on a new image', () => {
    expect(prepareLegacySceneImages([], [
      { url: '/new.webp', type: 'IMAGE', sortOrder: 0, isScene: true },
    ])[0].isScene).toBe(true);
  });

  it('does not transfer a removed image flag to a new URL or video', () => {
    expect(prepareLegacySceneImages([shared], [
      { url: '/new.webp', type: 'IMAGE', sortOrder: 0 },
      { url: shared.url, type: 'VIDEO', sortOrder: 1 },
    ]).map(row => row.isScene)).toEqual([false, false]);
  });

  it('refuses duplicate incoming URLs when an omitted flag would be ambiguous', () => {
    expect(() => prepareLegacySceneImages([shared], [
      { url: shared.url, type: 'IMAGE', sortOrder: 0 },
      { url: shared.url, type: 'IMAGE', sortOrder: 1 },
    ])).toThrow(/uniquely|ambiguous/i);
  });

  it('refuses ambiguous duplicate stored rows', () => {
    expect(() => prepareLegacySceneImages([shared, { ...shared, id: 'unmarked', isScene: false }], [
      { url: shared.url, type: 'IMAGE', sortOrder: 0 },
    ])).toThrow(/uniquely|ambiguous/i);
  });

  it('permits duplicate URLs when every incoming flag is explicit', () => {
    expect(prepareLegacySceneImages([shared], [
      { url: shared.url, type: 'IMAGE', sortOrder: 0, isScene: false },
      { url: shared.url, type: 'IMAGE', sortOrder: 1, isScene: true },
    ]).map(row => row.isScene)).toEqual([false, true]);
  });

  it('permits unmarked duplicate URLs without inferring a scene', () => {
    expect(prepareLegacySceneImages([{ ...shared, isScene: false }], [
      { url: shared.url, type: 'IMAGE', sortOrder: 0 },
      { url: shared.url, type: 'IMAGE', sortOrder: 1 },
    ]).map(row => row.isScene)).toEqual([false, false]);
  });

  it('refuses two explicit scenes in a shared replacement', () => {
    expect(() => prepareLegacySceneImages([], [
      { url: '/a.webp', type: 'IMAGE', sortOrder: 0, isScene: true },
      { url: '/b.webp', type: 'IMAGE', sortOrder: 1, isScene: true },
    ])).toThrow(/scene/i);
  });

  it('refuses a scene video in a direct legacy call', () => {
    expect(() => prepareLegacySceneImages([], [
      { url: '/a.mp4', type: 'VIDEO', sortOrder: 0, isScene: true },
    ])).toThrow(/scene.*image/i);
  });
});

const schemas = [
  ['graph', (row: Record<string, unknown>) => mediaWriteSchema.safeParse({ ...media, ...row })],
  ['legacy', (row: Record<string, unknown>) => updateProductSchema.safeParse({ images: [{ url: media.url, ...row }] })],
] as const;

describe('scene metadata DTOs', () => {
  it.each([true, false])('keeps an explicit graph scene flag %s', (isScene) => {
    expect(mediaWriteSchema.parse({ ...media, isScene })).toHaveProperty('isScene', isScene);
  });

  it.each([true, false])('keeps an explicit legacy scene flag %s', (isScene) => {
    const result = updateProductSchema.parse({ images: [{ url: media.url, isScene }] });
    expect(result.images?.[0]).toHaveProperty('isScene', isScene);
  });

  it('does not default an omitted graph flag to false', () => {
    expect(mediaWriteSchema.parse(media)).not.toHaveProperty('isScene');
  });

  it('does not default an omitted legacy flag to false', () => {
    expect(updateProductSchema.parse({ images: [{ url: media.url }] }).images?.[0]).not.toHaveProperty('isScene');
  });

  for (const [name, parse] of schemas) {
    it(`${name} refuses to mark a video as a scene`, () => {
      const result = parse({ type: 'VIDEO', isScene: true });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue => issue.path.at(-1) === 'isScene')).toBe(true);
    });

    it.each(['true', 1, null])(`${name} refuses non-boolean scene value %s`, (isScene) => {
      expect(parse({ isScene }).success).toBe(false);
    });

    it(`${name} accepts an ordinary video with an explicit false flag`, () => {
      expect(parse({ type: 'VIDEO', isScene: false }).success).toBe(true);
    });
  }

  it('keeps graph media scope XOR validation', () => {
    expect(mediaWriteSchema.safeParse({
      ...media, isScene: true,
      optionValueId: '11111111-1111-4111-8111-111111111111',
      variantId: '22222222-2222-4222-8222-222222222222',
    }).success).toBe(false);
  });
});
