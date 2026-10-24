import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { normaliseLandingContent, type LandingBlock, type LandingContent } from './landing-content.js';

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraph(text: string): string {
  return '<p>' + escapeText(text).replace(/\n/g, '<br>') + '</p>';
}

export function contentHash(content: LandingContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function mergeLandingSources(
  current: LandingContent,
  source: LandingContent,
  selectedKeys: string[],
  insertBeforeId?: string | null,
): LandingContent {
  const blocks = structuredClone(current.blocks);
  for (const key of selectedKeys) {
    const incoming = source.blocks.find((block) => block.sourceKey === key);
    if (!incoming) throw new BadRequestException('The selected source no longer exists.');
    const existing = blocks.findIndex((block) => block.sourceKey === key);
    if (existing >= 0) {
      blocks[existing] = { ...structuredClone(incoming), id: blocks[existing]!.id };
      continue;
    }
    if (insertBeforeId === undefined)
      throw new BadRequestException('Choose an insertion position for a removed source block.');
    const index = insertBeforeId === null ? blocks.length : blocks.findIndex((block) => block.id === insertBeforeId);
    if (index < 0) throw new BadRequestException('The insertion position no longer exists.');
    const id = blocks.some((block) => block.id === incoming.id) ? randomUUID() : incoming.id;
    blocks.splice(index, 0, { ...structuredClone(incoming), id });
  }
  return normaliseLandingContent({ ...current, blocks });
}

@Injectable()
export class LandingSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshotFromProduct(productId: string, database: Pick<Prisma.TransactionClient, 'product'> = this.prisma): Promise<LandingContent> {
    const product = await database.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, tagline: true, description: true, features: true, seoTitle: true, metaDescription: true,
        images: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { url: true, type: true, altText: true, optionValueId: true, variantId: true },
        },
        detailBlocks: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { url: true, type: true, altText: true, optionValueId: true, variantId: true },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    const from = (type: string) => `${type}:${product.id}`;
    const blocks: LandingBlock[] = [
      { id: 'hero', type: 'hero', sourceKey: from('hero'), props: { title: product.name, tagline: product.tagline, promoHeadline: null, promoSubtext: null } },
      { id: 'gallery', type: 'gallery', sourceKey: from('gallery'), props: { media: product.images } },
      { id: 'buy', type: 'buy', sourceKey: from('buy'), props: {} },
    ];
    // The admin marks a bullet hidden by prefixing the stored line; landing
    // copy is storefront-facing, so those lines never leave the backend.
    const features = (product.features ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[hidden] '));
    const body = (product.description ? paragraph(product.description) : '') +
      (features.length ? '<ul>' + features.map((line) => '<li>' + escapeText(line) + '</li>').join('') + '</ul>' : '');
    if (body)
      blocks.push({ id: 'description', type: 'richText', sourceKey: from('description'), props: { html: body } });
    if (product.detailBlocks.length)
      blocks.push({ id: 'detail', type: 'detail', sourceKey: from('detail'), props: { media: product.detailBlocks.map((item) => ({ url: item.url, type: item.type, altText: item.altText, optionValueId: item.optionValueId, variantId: item.variantId })) } });
    blocks.push(
      { id: 'facts', type: 'facts', sourceKey: from('facts'), props: {} },
      { id: 'reviews', type: 'reviews', sourceKey: from('reviews'), props: {} },
      { id: 'faq', type: 'faq', sourceKey: from('faq'), props: {} },
    );
    return normaliseLandingContent({ schemaVersion: 1, seoTitle: product.seoTitle, seoDescription: product.metaDescription, blocks });
  }

  async assertBindings(productId: string, content: LandingContent): Promise<void> {
    const media = content.blocks.flatMap((block) => block.type === 'gallery' || block.type === 'detail' ? block.props.media : []);
    const variantIds = [...new Set(media.flatMap((item) => item.variantId ? [item.variantId] : []))];
    const optionValueIds = [...new Set(media.flatMap((item) => item.optionValueId ? [item.optionValueId] : []))];
    if (media.some((item) => item.variantId && item.optionValueId))
      throw new BadRequestException('A media item cannot bind both a variant and an option value.');
    const [variants, values] = await Promise.all([
      variantIds.length ? this.prisma.productVariant.findMany({ where: { productId, id: { in: variantIds } }, select: { id: true } }) : [],
      optionValueIds.length ? this.prisma.productOptionValue.findMany({ where: { productId, id: { in: optionValueIds } }, select: { id: true } }) : [],
    ]);
    if (variants.length !== variantIds.length || values.length !== optionValueIds.length)
      throw new BadRequestException({ code: 'LANDING_MEDIA_BINDING_INVALID', message: 'Media bindings must belong to the parent product.' });
  }
}
