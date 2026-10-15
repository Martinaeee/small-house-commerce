import type { Data } from "@puckeditor/core";

export interface LandingMedia {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
  optionValueId: string | null;
  variantId: string | null;
}

interface BlockIdentity {
  id: string;
  sourceKey: string | null;
}
export interface LandingBlockProps {
  hero: { title: string; tagline: string | null; promoHeadline: string | null; promoSubtext: string | null };
  gallery: { media: LandingMedia[] };
  detail: { media: LandingMedia[] };
  richText: { html: string };
  custom: { html: string };
  buy: Record<string, never>;
  facts: Record<string, never>;
  reviews: Record<string, never>;
  faq: Record<string, never>;
}
export type LandingBlockType = keyof LandingBlockProps;
export type LandingBlock = {
  [K in LandingBlockType]: BlockIdentity & { type: K; props: LandingBlockProps[K] };
}[LandingBlockType];
export interface LandingContent {
  schemaVersion: 1;
  seoTitle: string | null;
  seoDescription: string | null;
  startAt: string | null;
  endAt: string | null;
  blocks: LandingBlock[];
}

const PRODUCT_LEAD_TYPES = ["hero", "gallery", "buy"] as const;

export function partitionFixedProductLead(blocks: readonly LandingBlock[]): { lead: LandingBlock[]; details: LandingBlock[] } {
  const lead = PRODUCT_LEAD_TYPES.flatMap((type) => {
    const inherited = blocks.find((block) => block.type === type && block.sourceKey?.startsWith(`${type}:`));
    const block = inherited ?? blocks.find((item) => item.type === type);
    return block ? [block] : [];
  });
  const fixed = new Set(lead);
  return { lead, details: blocks.filter((block) => !fixed.has(block)) };
}

export function withFixedProductLead(content: LandingContent): LandingContent {
  const { lead, details } = partitionFixedProductLead(content.blocks);
  return { ...content, blocks: [...lead, ...details] };
}

export type MarketingEditorProps = {
  [K in LandingBlockType]: { sourceKey?: string | null; sourceBlockId?: string | null } &
    (K extends "buy" | "facts" | "reviews" | "faq" ? Record<never, never> : LandingBlockProps[K]);
};
export interface MarketingEditorRoot {
  seoTitle: string | null;
  seoDescription: string | null;
  startAt: string | null;
  endAt: string | null;
}
export type MarketingEditorData = Data<MarketingEditorProps, MarketingEditorRoot>;

export function toPuckData(content: LandingContent): MarketingEditorData {
  return {
    content: content.blocks.map((block) => ({
      type: block.type,
      props: { ...block.props, id: block.id, sourceKey: block.sourceKey, sourceBlockId: block.sourceKey ? block.id : null },
    })) as MarketingEditorData["content"],
    root: { props: { seoTitle: content.seoTitle, seoDescription: content.seoDescription, startAt: content.startAt ?? null, endAt: content.endAt ?? null } },
  };
}

export function editorBlockToContent(item: { type: string; props: Record<string, unknown> }): LandingBlock {
  const value = item.props;
  const identity = {
    id: value.id as string,
    sourceKey: value.sourceBlockId === value.id ? (value.sourceKey as string | null) : null,
  };
  switch (item.type) {
    case "hero":
      return { ...identity, type: "hero", props: {
        title: value.title as string,
        tagline: (value.tagline as string) || null,
        promoHeadline: (value.promoHeadline as string) || null,
        promoSubtext: (value.promoSubtext as string) || null,
      } };
    case "gallery":
    case "detail":
      return { ...identity, type: item.type, props: { media: (value.media as LandingMedia[]).map((media) => ({
        url: media.url, type: media.type, altText: media.altText || null,
        optionValueId: media.optionValueId || null, variantId: media.variantId || null,
      })) } };
    case "richText":
    case "custom":
      return { ...identity, type: item.type, props: { html: value.html as string } };
    case "buy":
    case "facts":
    case "reviews":
    case "faq":
      return { ...identity, type: item.type, props: {} };
    default:
      throw new Error(`Unsupported landing block: ${item.type}`);
  }
}

export function fromPuckData(data: MarketingEditorData): LandingContent {
  return {
    schemaVersion: 1,
    seoTitle: data.root.props?.seoTitle || null,
    seoDescription: data.root.props?.seoDescription || null,
    startAt: data.root.props?.startAt || null,
    endAt: data.root.props?.endAt || null,
    blocks: data.content.map((item) => editorBlockToContent(item)),
  };
}
