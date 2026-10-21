import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingViewTracker } from "@/components/product/LandingViewTracker";
import { LandingContentView } from "@/components/product/LandingContentView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import { serverApiUrl, type LandingPageComposite } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { fetchCategoryInfo, fetchRelatedProducts } from "@/lib/pdp-products";

export const revalidate = 120;

async function fetchLandingPage(slug: string, variantId?: string | null): Promise<LandingPageComposite | null> {
  try {
    const query = variantId ? `?variantId=${encodeURIComponent(variantId)}` : "";
    const res = await fetch(serverApiUrl(`/api/v1/storefront/lp/${encodeURIComponent(slug)}${query}`), {
      next: { revalidate, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return null;
    return await res.json() as LandingPageComposite;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchLandingPage(slug);
  if (!data) return { title: "Product not found" };
  const content = data.landingPage.content;
  const hero = content.blocks.find((block) => block.type === "hero");
  const gallery = content.blocks.find((block) => block.type === "gallery");
  const title = content.seoTitle ?? hero?.props.title ?? data.product.name;
  const description = content.seoDescription ?? undefined;
  const images = gallery?.props.media.filter((media) => media.type === "IMAGE").map((media) => absoluteUrl(media.url)) ?? [];
  return {
    title, description,
    alternates: { canonical: `/products/${data.product.slug}` },
    openGraph: { title, description, url: `/products/${data.product.slug}`, type: "website", images: images.length ? images : undefined },
    twitter: { card: images.length ? "summary_large_image" : "summary", title, description, images: images.length ? images : undefined },
  };
}

export default async function LandingPageRoute({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const initialVariantId = typeof query.variant === "string" ? query.variant : null;
  const base = await fetchLandingPage(slug);
  if (!base) notFound();
  const selectable = base.product.variants.some((variant) => variant.id === initialVariantId && variant.sku?.status === "ACTIVE" && variant.sku.price !== null);
  const data = selectable ? (await fetchLandingPage(slug, initialVariantId)) ?? base : base;
  const { product, landingPage } = data;
  const [category, related] = await Promise.all([
    fetchCategoryInfo(product.categoryId),
    fetchRelatedProducts(product.categoryId, product.id, { revalidate }),
  ]);
  return <>
    <Suspense fallback={null}><LandingViewTracker landingPageId={landingPage.id} slug={landingPage.slug} /></Suspense>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildProductJsonLd(product, category)).replace(/</g, "\\u003c") }} />
    <LandingContentView
      content={landingPage.content}
      approvedContent={landingPage.content}
      product={product}
      delivery={deliveryWindows()}
      related={related}
      productPath={`/lp/${landingPage.slug}`}
      initialVariantId={initialVariantId}
    />
  </>;
}
