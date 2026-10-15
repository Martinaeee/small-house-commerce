"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Product, ProductImage } from "@/lib/api";
import { partitionFixedProductLead, type LandingBlock, type LandingContent, type LandingMedia } from "@/lib/marketing-content";
import { selectLandingMedia } from "@/lib/marketing-media";
import { deliveryWindows, type DeliveryWindows } from "@/lib/deliveryWindow";
import { CartPreviewProvider } from "@/components/cart/CartContext";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { PdpClient } from "./PdpClient";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import { PdpQuickCodOrder } from "./PdpQuickCodOrder";
import { ProductGallery } from "./ProductGallery";
import { ProductLightbox } from "./ProductLightbox";
import { ProductDetailMedia } from "./ProductDetailBody";
import { ProductSpecs, MaterialDimensions } from "./ProductSpecs";
import { PdpInfoSections } from "./PdpInfoSections";
import { ReviewSection } from "./ReviewSection";
import { ProductCard } from "./ProductCard";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";

interface Runtime {
  product: Product | null;
  approvedContent: LandingContent;
  preview: boolean;
  delivery: DeliveryWindows;
  productPath?: string;
  initialVariantId?: string | null;
}
const RuntimeContext = createContext<Runtime | null>(null);

function useRuntime(): Runtime {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("Landing blocks need their product runtime.");
  return value;
}

export function LandingBlocksProvider({
  product, approvedContent, preview = false, delivery = deliveryWindows(),
  productPath, initialVariantId, children,
}: Runtime & { children: ReactNode }) {
  let body = product
    ? <PdpPurchaseProvider product={product} initialVariantId={initialVariantId}>{children}</PdpPurchaseProvider>
    : children;
  if (preview) body = <CartPreviewProvider>{body}</CartPreviewProvider>;
  return <RuntimeContext.Provider value={{ product, approvedContent, preview, delivery, productPath, initialVariantId }}>{body}</RuntimeContext.Provider>;
}

function MediaView({ media, id, detail }: { media: readonly LandingMedia[]; id: string; detail: boolean }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const images: ProductImage[] = media.map((item, index) => ({ id: `${id}-${index}`, url: item.url, type: item.type, altText: item.altText, sortOrder: index }));
  if (detail) return <ProductDetailMedia blocks={images} />;
  return <>
    <ProductGallery images={images} active={active} onSelect={setActive} onOpenLightbox={setLightbox} />
    {lightbox !== null && images.length > 0 && <ProductLightbox images={images} productName="Product gallery" index={lightbox} onClose={() => setLightbox(null)} onNavigate={setLightbox} />}
  </>;
}

function ScopedMedia({ block }: { block: Extract<LandingBlock, { type: "gallery" | "detail" }> }) {
  const { product } = useRuntime();
  const { primaryLine, primaryDerived } = usePdpPurchase();
  const result = selectLandingMedia(block.props.media, product, primaryLine.selectedValueIds, primaryDerived.resolvedVariant?.id ?? null);
  const key = JSON.stringify([block.id, primaryLine.selectedValueIds, primaryDerived.resolvedVariant?.id]);
  return <>
    {(result.staleBindingCount > 0 || result.blockedUrlCount > 0) && <p className="mb-2 text-sm text-ink-muted">Some media are unavailable for this option.</p>}
    <MediaView key={key} media={result.media} id={block.id} detail={block.type === "detail"} />
  </>;
}

function LiveFacts({ product }: { product: Product }) {
  const { primaryDerived } = usePdpPurchase();
  const sku = primaryDerived.displayVariant?.sku ?? null;
  return <div className="space-y-4">
    <ProductSpecs product={product} productWeight={sku?.productWeight ?? null} includeFeatures={false} />
    <MaterialDimensions product={product} />
  </div>;
}

function useLinkedVariantUnavailable(): boolean {
  const { initialVariantId } = useRuntime();
  const { primaryDerived } = usePdpPurchase();
  return Boolean(initialVariantId && !primaryDerived.selectableVariants.some(variant => variant.id === initialVariantId) && !primaryDerived.purchaseConfirmed);
}

function LiveOrderForm() {
  const { preview } = useRuntime();
  const unavailable = useLinkedVariantUnavailable();
  if (preview || unavailable) return null;
  return <div data-landing-product-order="true" className="lg:col-span-2"><PdpQuickCodOrder /></div>;
}

function LivePurchase({ product, includeOrderForm = true }: { product: Product; includeOrderForm?: boolean }) {
  const { preview, delivery, productPath } = useRuntime();
  const unavailable = useLinkedVariantUnavailable();
  return <>
    {unavailable && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The linked option is unavailable. Please choose another option to continue.</p>}
    <PdpClient product={product} category={null} delivery={delivery} productPath={productPath} purchaseOnly preview={preview} />
    {includeOrderForm && <LiveOrderForm />}
  </>;
}

export function MarketingBlocks({ block, includeOrderForm = true, className }: { block: LandingBlock; includeOrderForm?: boolean; className?: string }) {
  const { product, approvedContent, preview } = useRuntime();
  const settings = useSiteSettings();
  let body: ReactNode;
  switch (block.type) {
    case "hero":
      body = <div className="space-y-2">
        {block.props.promoHeadline && <aside className="rounded-lg bg-sale px-4 py-3 text-white"><p className="font-bold">{block.props.promoHeadline}</p>{block.props.promoSubtext && <p className="text-sm">{block.props.promoSubtext}</p>}</aside>}
        <h1 className="text-product-title font-semibold text-ink lg:text-product-title-desktop">{block.props.title}</h1>
        {block.props.tagline && <p className="text-product-subtitle text-ink-secondary">{block.props.tagline}</p>}
      </div>;
      break;
    case "gallery":
    case "detail":
      body = product ? <ScopedMedia block={block} /> : <MediaView media={selectLandingMedia(block.props.media, null, {}, null).media} id={block.id} detail={block.type === "detail"} />;
      break;
    case "buy":
      body = product ? <LivePurchase product={product} includeOrderForm={includeOrderForm} /> : <p className="text-sm text-ink-muted">Purchase is unavailable while the parent product is inactive.</p>;
      break;
    case "richText":
    case "custom": {
      const approved = approvedContent.blocks.find((item) => item.id === block.id && item.type === block.type);
      const verified = approved && (approved.type === "richText" || approved.type === "custom") && approved.props.html === block.props.html;
      body = verified
        ? <div className="text-sm leading-relaxed text-ink-secondary [&_p]:my-3 [&_h3]:my-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:my-3 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_a]:text-cta [&_a]:underline" dangerouslySetInnerHTML={{ __html: approved.props.html }} />
        : <div className="whitespace-pre-wrap text-sm text-ink-muted">{block.props.html}</div>;
      break;
    }
    case "facts":
      body = product ? <LiveFacts product={product} /> : <p className="text-sm text-ink-muted">Live product facts are unavailable.</p>;
      break;
    case "reviews":
      body = product ? <div inert={preview || undefined}><ReviewSection product={product} /></div> : <p className="text-sm text-ink-muted">Live reviews are unavailable.</p>;
      break;
    case "faq":
      body = product ? <PdpInfoSections items={product.effectiveFaq ?? []} supportEmail={settings.supportEmail} supportHours={settings.supportHours} /> : <p className="text-sm text-ink-muted">Live product FAQ is unavailable.</p>;
      break;
  }
  return <div className={className} data-landing-block={block.type} data-block-id={block.id}>{body}</div>;
}

function LandingProductLead({ hero, gallery, buy }: {
  hero?: Extract<LandingBlock, { type: "hero" }>;
  gallery?: Extract<LandingBlock, { type: "gallery" }>;
  buy: Extract<LandingBlock, { type: "buy" }>;
}) {
  const { product } = useRuntime();
  return <section data-landing-product-lead="true" className={`grid grid-cols-1 gap-6 lg:items-start lg:gap-8 ${gallery ? "lg:grid-cols-2" : ""}`}>
    {gallery && <MarketingBlocks block={gallery} />}
    <div data-landing-purchase-column="true" className="space-y-4">
      {hero
        ? <MarketingBlocks block={hero} />
        : product && <div><h1 className="text-product-title font-semibold text-ink lg:text-product-title-desktop">{product.name}</h1>{product.tagline?.trim() && <p className="mt-2 text-product-subtitle text-ink-secondary">{product.tagline}</p>}</div>}
      <MarketingBlocks block={buy} includeOrderForm={false} />
    </div>
    {product && <LiveOrderForm />}
  </section>;
}

function LandingBlockSequence({ blocks }: { blocks: LandingContent["blocks"] }) {
  const { lead, details } = partitionFixedProductLead(blocks);
  const hero = lead.find((block): block is Extract<LandingBlock, { type: "hero" }> => block.type === "hero");
  const gallery = lead.find((block): block is Extract<LandingBlock, { type: "gallery" }> => block.type === "gallery");
  const buy = lead.find((block): block is Extract<LandingBlock, { type: "buy" }> => block.type === "buy");
  return <>
    {buy && <LandingProductLead hero={hero} gallery={gallery} buy={buy} />}
    {details.map((block) => <MarketingBlocks key={block.id} block={block} />)}
  </>;
}

export function LandingBlocksLayout({ children }: { children: ReactNode }) {
  return <article className="landing-blocks-layout mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-6">{children}</article>;
}

export function LandingContentView({ content, approvedContent, product, preview = false, delivery = deliveryWindows(), productPath, initialVariantId, related = [] }: {
  content: LandingContent;
  approvedContent: LandingContent;
  product: Product | null;
  preview?: boolean;
  delivery?: DeliveryWindows;
  productPath?: string;
  initialVariantId?: string | null;
  related?: Product[];
}) {
  return <LandingBlocksProvider product={product} approvedContent={approvedContent} preview={preview} delivery={delivery} productPath={productPath} initialVariantId={initialVariantId}>
    <LandingBlocksLayout>
      <LandingBlockSequence blocks={content.blocks} />
      {!preview && related.length > 0 && <section>
        <h2 className="mb-4 text-2xl font-semibold text-ink">You May Also Like</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div>
      </section>}
      {!preview && product && <RecentlyViewed excludeProductId={product.id} limit={4} />}
    </LandingBlocksLayout>
  </LandingBlocksProvider>;
}
