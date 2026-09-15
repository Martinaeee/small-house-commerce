import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingViewTracker } from "@/components/product/LandingViewTracker";
import { PdpView } from "@/components/product/PdpView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import {
  serverApiUrl,
  type LandingPageComposite,
  type Paged,
  type Product,
  type ProductImage,
} from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
// One directory up from the lp route tree: reuse the PDP data helpers.
import { fetchCategoryInfo } from "../../products/[slug]/page";

export const revalidate = 120;

async function fetchLandingPage(slug: string): Promise<LandingPageComposite | null> {
  try {
    const res = await fetch(serverApiUrl(`/api/v1/storefront/lp/${slug}`), {
      next: { revalidate, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return null;
    return (await res.json()) as LandingPageComposite;
  } catch {
    return null;
  }
}

// Only visible H1/name and gallery are overridden; every shared field
// (reviews, SKUs, price, stock, specs) stays sourced from the real product.
function applyLandingOverrides(data: LandingPageComposite): Product {
  const { landingPage: lp, product } = data;
  const images: ProductImage[] =
    lp.imagesOverride && lp.imagesOverride.length > 0
      ? lp.imagesOverride.map((image, index) => ({
          id: `lp-${lp.id}-img-${index}`,
          url: image.url,
          altText: image.altText ?? null,
          sortOrder: index,
        }))
      : product.images;
  const name = lp.titleOverride?.trim() ? lp.titleOverride.trim() : product.name;
  return { ...product, name, images };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchLandingPage(slug);
  if (!data) return { title: "Product not found" };

  const merged = applyLandingOverrides(data);
  const description = data.landingPage.seoDescription ?? merged.description ?? undefined;
  const images = [...merged.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));
  const title = data.landingPage.seoTitle ?? merged.name;

  return {
    title,
    description,
    // LPs are marketing duplicates: canonical always points at the real PDP.
    alternates: { canonical: `/products/${data.product.slug}` },
    openGraph: {
      title,
      description,
      url: `/products/${data.product.slug}`,
      type: "website",
      images: images.length > 0 ? images : undefined,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images: images.length > 0 ? images : undefined,
    },
  };
}

export default async function LandingPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchLandingPage(slug);
  if (!data) notFound();

  const product = applyLandingOverrides(data);
  const lp = data.landingPage;

  const [category, relatedRes] = await Promise.all([
    fetchCategoryInfo(product.categoryId),
    fetch(
      serverApiUrl(`/api/v1/storefront/products?categoryId=${product.categoryId}&pageSize=5`),
      { next: { revalidate, tags: STOREFRONT_TAGS } },
    ).catch(() => null),
  ]);

  let related: Product[] = [];
  if (relatedRes?.ok) {
    try {
      related = ((await relatedRes.json()) as Paged<Product>).items.filter(
        (item) => item.id !== product.id,
      );
    } catch {
      related = [];
    }
  }

  const promoSlot =
    lp.promoEnabled && lp.promoHeadline ? (
      <div className="rounded-lg bg-sale px-4 py-3 text-white">
        <p className="text-base font-bold">{lp.promoHeadline}</p>
        {lp.promoSubtext ? <p className="mt-0.5 text-sm opacity-90">{lp.promoSubtext}</p> : null}
      </div>
    ) : null;

  return (
    <>
      <LandingViewTracker landingPageId={lp.id} slug={lp.slug} />
      {/* Real name/slug/images for structured data: LP is a marketing duplicate. */}
      <PdpView
        product={product}
        category={category}
        delivery={deliveryWindows()}
        related={related}
        jsonLd={buildProductJsonLd(data.product, category)}
        promoSlot={promoSlot}
        productPath={`/lp/${lp.slug}`}
      />
    </>
  );
}
