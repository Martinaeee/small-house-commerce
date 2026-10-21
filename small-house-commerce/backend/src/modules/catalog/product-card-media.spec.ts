import { describe, expect, it } from 'vitest';
import { buildProductCardMedia } from './product-card-media.js';
import type { ProductMediaGraph } from './product-media.resolver.js';
import type { VariantCardMedia } from './variant-card-media.js';

type CardGraph = ProductMediaGraph & {
  variants: Array<ProductMediaGraph['variants'][number] & { cardMedia?: VariantCardMedia | null }>;
};

function fixture(): CardGraph {
  return {
    id: 'p', catalogGraphVersion: 1,
    options: [{ id: 'color', isActive: true, isMediaDriver: true,
      values: [{ id: 'red', isActive: true }, { id: 'blue', isActive: true }] }],
    variants: [
      { id: 'vr', sku: { status: 'ACTIVE' }, optionValues: [{ optionId: 'color', optionValueId: 'red' }],
        cardMedia: {
          cover: { type: 'IMAGE', url: '/uploads/red-card.webp', altText: 'Red white background' },
          hover: { type: 'IMAGE', url: '/uploads/red-card-hover.webp', altText: 'Red in a room' },
        } },
      { id: 'vb', sku: { status: 'ACTIVE' }, optionValues: [{ optionId: 'color', optionValueId: 'blue' }],
        cardMedia: { cover: { type: 'IMAGE', url: '/uploads/blue-card.webp', altText: null }, hover: null } },
      { id: 'disabled', sku: { status: 'DISABLED' }, optionValues: [] },
      { id: 'unpriced', sku: { status: 'ACTIVE' }, optionValues: [] },
    ],
    images: [
      { id: 'shared', url: '/shared.webp', type: 'IMAGE', altText: null, sortOrder: 0,
        optionValueId: null, variantId: null, isScene: true },
      { id: 'red', url: '/red-gallery.webp', type: 'IMAGE', altText: 'Gallery room', sortOrder: 0,
        optionValueId: 'red', variantId: null, isScene: true },
      { id: 'exact', url: '/exact-gallery.webp', type: 'IMAGE', altText: null, sortOrder: 0,
        optionValueId: null, variantId: 'vr' },
    ],
  };
}

function project(graph: CardGraph, ids: string[] = ['vr', 'vb'], displayId: string | null = 'vr') {
  return buildProductCardMedia(graph.variants, ids, displayId);
}

describe('buildProductCardMedia independent snapshots', () => {
  it('uses each real variant snapshot instead of any gallery scope', () => {
    const result = project(fixture());
    expect(result.variants).toEqual([
      { variantId: 'vr', cover: { id: 'card:vr:cover', url: '/uploads/red-card.webp', type: 'IMAGE',
        altText: 'Red white background', sortOrder: 0 },
      scene: { id: 'card:vr:hover', url: '/uploads/red-card-hover.webp', type: 'IMAGE',
        altText: 'Red in a room', sortOrder: 0 } },
      { variantId: 'vb', cover: { id: 'card:vb:cover', url: '/uploads/blue-card.webp', type: 'IMAGE',
        altText: null, sortOrder: 0 }, scene: null },
    ]);
  });

  it('uses the explicitly stored selectable display variant', () => {
    const result = project(fixture(), ['vr', 'vb'], 'vb');
    expect(result).toHaveProperty('displayVariantId', 'vb');
    expect(result.unselected).toEqual(result.variants[1] && {
      cover: result.variants[1].cover, scene: null,
    });
  });

  it.each([null, 'foreign', 'disabled', 'unpriced'])('does not infer a default for %s', displayId => {
    const result = project(fixture(), ['vr', 'vb'], displayId);
    expect(result).toHaveProperty('displayVariantId', null);
    expect(result.unselected).toEqual({ cover: null, scene: null });
  });

  it('does not borrow another variant or a shared image when configuration is absent', () => {
    const graph = fixture();
    graph.variants[1]!.cardMedia = null;
    expect(project(graph).variants[1]).toEqual({ variantId: 'vb', cover: null, scene: null });
  });

  it('does not use a hover image without its own cover', () => {
    const graph = fixture();
    graph.variants[0]!.cardMedia!.cover = null;
    const result = project(graph);
    expect(result.unselected).toEqual({ cover: null, scene: null });
    expect(result.variants[0]).toEqual({ variantId: 'vr', cover: null, scene: null });
  });

  it('keeps the cover when hover is unconfigured', () => {
    const graph = fixture();
    graph.variants[0]!.cardMedia!.hover = null;
    expect(project(graph).unselected).toMatchObject({
      cover: { url: '/uploads/red-card.webp' }, scene: null,
    });
  });

  it('projects supplied selectable identities in order without disabled or unpriced rows', () => {
    expect(project(fixture(), ['vb', 'vr']).variants.map(row => row.variantId)).toEqual(['vb', 'vr']);
  });

  it('does not allow a foreign selectable id to become the stored default', () => {
    const result = project(fixture(), ['foreign'], 'foreign');
    expect(result).toHaveProperty('displayVariantId', null);
    expect(result.unselected).toEqual({ cover: null, scene: null });
    expect(result.variants).toEqual([{ variantId: 'foreign', cover: null, scene: null }]);
  });

  it('preserves separately chosen alt text even when both slots use the same URL', () => {
    const graph = fixture();
    graph.variants[0]!.cardMedia!.hover = { type: 'IMAGE', url: '/uploads/red-card.webp', altText: 'Hover description' };
    expect(project(graph).unselected).toMatchObject({
      cover: { url: '/uploads/red-card.webp', altText: 'Red white background' },
      scene: { url: '/uploads/red-card.webp', altText: 'Hover description' },
    });
  });

  it('retains snapshots when gallery rows are reordered, replaced or deleted', () => {
    const graph = fixture();
    const before = project(graph);
    graph.images.reverse();
    graph.images[0]!.url = '/replacement.webp';
    graph.images = [];
    expect(project(graph)).toEqual(before);
    expect(project(graph).unselected.cover?.url).toBe('/uploads/red-card.webp');
  });

  it('does not depend on legacy materialization or media-driver metadata', () => {
    const graph = fixture();
    graph.catalogGraphVersion = 0;
    graph.options = [];
    expect(project(graph).variants[0]?.cover?.url).toBe('/uploads/red-card.webp');
    expect(project(graph, ['vr', 'vb'], null).unselected).toEqual({ cover: null, scene: null });
  });

  it('whitelists public image fields without mutating stored snapshots', () => {
    const graph = fixture();
    Object.assign(graph.variants[0]!.cardMedia!.cover!, {
      productId: 'private', supplierCost: 123, isScene: true, optionValueId: 'red',
    });
    const before = structuredClone(graph);
    const result = project(graph);
    expect(Object.keys(result.variants[0]!.cover!).sort()).toEqual(['altText', 'id', 'sortOrder', 'type', 'url']);
    expect(JSON.stringify(result)).not.toMatch(/isScene|optionValueId|productId|supplierCost|bundleComponents/);
    expect(graph).toEqual(before);
  });

  it('returns an empty projection without inventing any default', () => {
    const graph = fixture();
    graph.variants = [];
    expect(project(graph, [], null)).toEqual({
      displayVariantId: null, unselected: { cover: null, scene: null }, variants: [],
    });
  });
});
