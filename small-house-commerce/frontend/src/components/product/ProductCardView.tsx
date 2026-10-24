import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import type { ProductSelectionDerived } from "@/lib/product-selection";
import { cardMediaForSelection, cardPricePresentation } from "@/lib/product-card-presentation";
import { formatPrice } from "@/components/ui/PriceBox";
import type { PurchaseLineState } from "./PdpPurchaseProvider";
import type { ProductCardProps } from "./ProductCard";
import { ProductCardImage } from "./ProductCardImage";
import { ProductCardVariantSelector } from "./ProductCardVariantSelector";
import { RatingStars } from "./RatingStars";

export interface ProductCardViewProps extends ProductCardProps {
  primaryLine: PurchaseLineState;
  derived: ProductSelectionDerived;
  selectorRoot: RefObject<HTMLDivElement | null>;
  action: ReactNode;
}

export function ProductCardView({ product, badge, badges = [], interactionMode = "storefront",
  navigationTrackAttrs, primaryLine, derived, selectorRoot, action }: ProductCardViewProps) {
  const preview = interactionMode === "preview";
  const previewVariant = preview ? product.variants.find(row => row.id === product.cardMedia?.displayVariantId) : undefined;
  const variant = previewVariant ?? derived.resolvedVariant;
  const href = preview ? null : variant
    ? `/products/${product.slug}?variant=${encodeURIComponent(variant.id)}` : `/products/${product.slug}`;
  const media = cardMediaForSelection(product, variant?.id ?? null, primaryLine.selectedValueIds);
  const price = previewVariant
    ? previewVariant.sku?.price != null ? { kind: "exact" as const, price: previewVariant.sku.price, compareAtPrice: previewVariant.sku.compareAtPrice } : null
    : cardPricePresentation(derived);
  const stock = variant?.sku?.availableInventory;
  const outOfStock = derived.selectableVariants.length === 0 || (stock !== undefined && stock <= 0);
  const showVariantStrip =
    product.options.length > 0 &&
    (preview ? product.variants.length : derived.selectableVariants.length) > 1;
  return (
    <article data-product-id={product.id} className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-[translate,box-shadow] duration-200 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_8px_24px_rgba(0,0,0,0.14)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hover:-translate-y-1.5">
      <ProductCardImage productName={product.name} media={media} href={href} navigationTrackAttrs={navigationTrackAttrs}>
        {badge ? <span className="absolute right-3 top-3 rounded bg-cta px-2 py-1 text-xs font-semibold text-cta-foreground">{badge}</span> : null}
        {outOfStock || badges.length > 0 ? (
          <span className="absolute left-3 top-3 flex flex-col items-start gap-1" data-testid="card-left-chips">
            {outOfStock ? <span className="rounded bg-ink/80 px-2 py-1 text-xs font-semibold text-white">Out of Stock</span> : null}
            {badges.slice(0, 2).map(item => <span key={`${item.kind}-${item.label}`}
              className={`rounded px-2 py-1 text-xs font-semibold text-white ${item.kind === "promo" ? "bg-sale" : item.kind === "new" ? "bg-primary-dark/90" : "bg-ink/85"}`}>
              {item.label}
            </span>)}
          </span>
        ) : null}
      </ProductCardImage>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2 sm:p-3">
        <h3 data-testid="card-name" title={product.name} className="truncate text-sm font-semibold text-ink">
          {href ? <Link href={href} prefetch={false} className="hover:text-cta" {...navigationTrackAttrs}>{product.name}</Link> : product.name}
        </h3>
        {product.ratingAverage != null && product.reviewCount > 0 ? (
          <div className="flex items-center gap-1" data-testid="card-rating">
            <RatingStars value={product.ratingAverage} className="text-xs" />
            <span className="text-xs font-medium text-ink-secondary">{product.ratingAverage.toFixed(1)}</span>
            <span className="text-xs text-ink-muted">({product.reviewCount})</span>
          </div>
        ) : null}
        {price ? (
          <div data-testid="card-price-row" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span data-testid="price" className="whitespace-nowrap text-[16px] font-bold leading-tight text-sale sm:text-[18px]">
              {price.kind === "from" ? `From ${formatPrice(price.price)}` : formatPrice(price.price)}
            </span>
            {price.kind === "exact" && price.compareAtPrice != null && price.compareAtPrice > price.price ? (
              <span data-testid="card-compare-at" className="whitespace-nowrap text-xs leading-tight text-ink-muted line-through">
                {formatPrice(price.compareAtPrice)}
              </span>
            ) : null}
          </div>
        ) : null}
        {showVariantStrip ? (
          <div ref={selectorRoot} data-testid="card-variant-strip" className="min-w-0">
            <ProductCardVariantSelector lineId={primaryLine.clientLineId} disabled={preview} preview={preview} />
          </div>
        ) : null}
        <div className="relative mt-auto pt-1.5">{action}</div>
      </div>
    </article>
  );
}
