import Link from "next/link";
import type { Product } from "@/lib/api";
import { ButtonLink } from "@/components/ui/Button";
import { formatPrice, PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { cardPricePresentation } from "@/lib/product-card-presentation";
import {
  createInitialSelection,
  resolveSelection,
} from "@/lib/product-selection";

/**
 * DESIGN_SYSTEM §12 Product Card — the core reusable component.
 * Structure: image (4:5) → badge → name → price → CTA.
 * Used on Homepage, Collection and Related Products.
 * Media and price come from the backend's effective cover and the shared
 * selection contract — never from positional images[0]/variants[0] picks.
 */

interface ProductCardProps {
  product: Product;
  /** Section-provided corner badge (e.g. 新品). Undefined = no chip. */
  badge?: string;
}

export function ProductCard({ product, badge }: ProductCardProps) {
  const cover = product.effectiveCoverMedia;
  const derived = resolveSelection(
    product,
    createInitialSelection(product, null),
  );
  const sellable = derived.selectableVariants;
  const directSku = sellable.length === 1 ? (sellable[0].sku ?? null) : null;
  // Only a single-SKU product (or one with nothing sellable at all) owns a
  // whole-card stock verdict; multi-SKU products decide stock on the PDP.
  const outOfStock =
    sellable.length === 0 ||
    (directSku !== null && directSku.availableInventory <= 0);
  const price = cardPricePresentation(derived);

  const image = cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cover.url}
      alt={cover.altText ?? product.name}
      className="aspect-[4/5] w-full object-cover"
      loading="lazy"
    />
  ) : (
    <PlaceholderImage label={product.name} className="aspect-[4/5] w-full" />
  );

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md">
      <Link href={`/products/${product.slug}`} className="relative block">
        {image}
        {badge ? (
          <span className="absolute right-3 top-3 rounded bg-cta px-2 py-1 text-xs font-semibold text-white">
            {badge}
          </span>
        ) : null}
        {outOfStock && (
          <span className="absolute left-3 top-3 rounded bg-ink/80 px-2 py-1 text-xs font-semibold text-white">
            Out of Stock
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold text-ink">
          <Link href={`/products/${product.slug}`} className="hover:text-cta">
            {product.name}
          </Link>
        </h3>

        {price ? (
          price.kind === "exact" ? (
            <PriceBox price={price.price} compareAtPrice={price.compareAtPrice} />
          ) : (
            <p className="text-lg font-bold text-ink" data-testid="price">
              From {formatPrice(price.price)}
            </p>
          )
        ) : null}

        <div className="mt-auto pt-2">
          <ButtonLink
            href={`/products/${product.slug}`}
            variant={outOfStock ? "secondary" : "primary"}
            size="md"
            className="w-full"
          >
            {outOfStock ? "View Details" : "Order Now"}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
