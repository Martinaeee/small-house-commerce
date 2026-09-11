import Link from "next/link";
import type { Product } from "@/lib/api";
import { ButtonLink } from "@/components/ui/Button";
import { PriceBox } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

/**
 * DESIGN_SYSTEM §12 Product Card — the core reusable component.
 * Structure: image (4:5) → badge → name → price → CTA.
 * Used on Homepage, Collection and Related Products.
 */

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const firstImage = product.images[0]?.url;
  const firstSku = product.variants[0]?.sku ?? null;
  const outOfStock = firstSku !== null && firstSku.availableInventory <= 0;

  const image = firstImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={firstImage}
      alt={product.images[0]?.altText ?? product.name}
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

        <PriceBox price={firstSku?.price ?? null} compareAtPrice={firstSku?.compareAtPrice ?? null} />

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
