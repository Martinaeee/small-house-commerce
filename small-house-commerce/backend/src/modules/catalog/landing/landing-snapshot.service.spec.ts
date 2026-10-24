import { describe, expect, it, vi } from 'vitest';
import { LandingSnapshotService, contentHash, mergeLandingSources } from './landing-snapshot.service.js';

const product = () => ({
  id: '11111111-1111-4111-8111-111111111111', name: 'Saved title', tagline: 'Small space',
  description: 'A <script>literal</script> description', features: null as string | null, seoTitle: 'SEO', metaDescription: 'Meta',
  images: [{ url: '/uploads/a.jpg', type: 'IMAGE', altText: 'A', optionValueId: null, variantId: null }],
  detailBlocks: [{ id: 'd1', url: '/uploads/detail.mp4', type: 'VIDEO', altText: null }],
  price: 200, stock: 10,
});

async function snapshot(row = product()) {
  const prisma = { product: { findUnique: vi.fn(async () => row) } };
  return new LandingSnapshotService(prisma as never).snapshotFromProduct(row.id);
}

describe('saved product landing snapshots', () => {
  it('copies saved presentation and keeps transactional and factual modules live', async () => {
    const result = await snapshot();
    expect(result.blocks.map((block) => block.type)).toEqual(['hero', 'gallery', 'buy', 'richText', 'detail', 'facts', 'reviews', 'faq']);
    expect(result.blocks[0]).toMatchObject({ props: { title: 'Saved title', tagline: 'Small space' } });
    expect(result.blocks[2]).toMatchObject({ props: {} });
    expect(result.blocks[3]).toMatchObject({ props: { html: '<p>A &lt;script&gt;literal&lt;/script&gt; description</p>' } });
    expect(JSON.stringify(result)).not.toMatch(/"price"|"stock"|"cost"/);
  });

  it('copies saved feature text as escaped marketing content', async () => {
    const source = { ...product(), description: '', features: '  Space saving\n<script>Literal feature</script>\n\n' };
    const result = await snapshot(source);
    expect(result.blocks.find((block) => block.type === 'richText')).toMatchObject({
      props: { html: '<ul><li>Space saving</li><li>&lt;script&gt;Literal feature&lt;/script&gt;</li></ul>' },
    });
    expect(contentHash(result)).not.toBe(contentHash(await snapshot({ ...source, features: 'Changed feature' })));
  });

  it('leaves admin-hidden feature bullets out of the landing copy', async () => {
    const source = {
      ...product(),
      description: '',
      features: 'Space saving\n[hidden] Internal note\nFolds flat',
    };
    const result = await snapshot(source);
    expect(result.blocks.find((block) => block.type === 'richText')).toMatchObject({
      props: { html: '<ul><li>Space saving</li><li>Folds flat</li></ul>' },
    });
  });

  it('omits the feature list when every bullet is hidden', async () => {
    const result = await snapshot({
      ...product(),
      description: '',
      features: '[hidden] Internal note',
    });
    expect(result.blocks.some((block) => block.type === 'richText')).toBe(false);
  });

  it('ignores price and stock when detecting changed display content', async () => {
    const before = contentHash(await snapshot());
    expect(contentHash(await snapshot({ ...product(), price: 999, stock: 0 }))).toBe(before);
    expect(contentHash(await snapshot({ ...product(), name: 'Changed title' }))).not.toBe(before);
  });

  it('does not incorporate unrelated payload fields into the snapshot', async () => {
    const source = product();
    const result = await snapshot({ ...source, name: 'From database' });
    expect(result.blocks[0]).toMatchObject({ props: { title: 'From database' } });
    expect(result.seoTitle).toBe('SEO');
  });

  it('replaces selected source content in place without deleting custom changes', async () => {
    const current = await snapshot();
    current.blocks.splice(1, 0, { id: 'extra', type: 'custom', sourceKey: null, props: { html: '<p>My extra copy</p>' } });
    const latest = await snapshot({ ...product(), name: 'New title', tagline: 'New tagline' });
    const result = mergeLandingSources(current, latest, [current.blocks[0]!.sourceKey!]);
    expect(result.blocks[0]).toMatchObject({ id: current.blocks[0]!.id, props: { title: 'New title' } });
    expect(result.blocks[1]).toEqual({ id: 'extra', type: 'custom', sourceKey: null, props: { html: '<p>My extra copy</p>' } });
    expect(result.blocks.map((block) => block.id)).toEqual(current.blocks.map((block) => block.id));
  });

  it('requires an explicit insertion position when restoring a removed source', async () => {
    const latest = await snapshot();
    const current = { ...latest, blocks: latest.blocks.filter((block) => block.type !== 'gallery') };
    const gallery = latest.blocks.find((block) => block.type === 'gallery')!;
    expect(() => mergeLandingSources(current, latest, [gallery.sourceKey!])).toThrow();
    const result = mergeLandingSources(current, latest, [gallery.sourceKey!], 'buy');
    expect(result.blocks.map((block) => block.type)).toEqual(['hero', 'gallery', 'buy', 'richText', 'detail', 'facts', 'reviews', 'faq']);
  });

  it('rejects a media binding outside the parent product', async () => {
    const source = await snapshot();
    const gallery = source.blocks.find((block) => block.type === 'gallery')!;
    if (gallery.type !== 'gallery') throw new Error('Fixture missing gallery');
    gallery.props.media[0]!.variantId = '22222222-2222-4222-8222-222222222222';
    const prisma = {
      productVariant: { findMany: vi.fn(async () => []) },
      productOptionValue: { findMany: vi.fn(async () => []) },
    };
    await expect(new LandingSnapshotService(prisma as never).assertBindings(product().id, source)).rejects.toMatchObject({ status: 400 });
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
      where: { productId: product().id, id: { in: ['22222222-2222-4222-8222-222222222222'] } }, select: { id: true },
    });
  });

  it('allows same-product scoped media and rejects contradictory bindings', async () => {
    const source = await snapshot();
    const gallery = source.blocks.find((block) => block.type === 'gallery')!;
    if (gallery.type !== 'gallery') throw new Error('Fixture missing gallery');
    gallery.props.media[0]!.variantId = '22222222-2222-4222-8222-222222222222';
    const prisma = {
      productVariant: { findMany: vi.fn(async () => [{ id: '22222222-2222-4222-8222-222222222222' }]) },
      productOptionValue: { findMany: vi.fn(async () => []) },
    };
    const service = new LandingSnapshotService(prisma as never);
    await expect(service.assertBindings(product().id, source)).resolves.toBeUndefined();
    gallery.props.media[0]!.optionValueId = '33333333-3333-4333-8333-333333333333';
    await expect(service.assertBindings(product().id, source)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown source references rather than discarding them silently', async () => {
    const source = await snapshot();
    expect(() => mergeLandingSources(source, source, ['other-product:hero'])).toThrow();
  });
});
