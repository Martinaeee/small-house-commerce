import type { Metadata } from "next";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { serverApiUrl, type Collection } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export const metadata: Metadata = { title: "Shop by Space" };
export const revalidate = 300;

export default async function CollectionsIndexPage() {
  let collections: Collection[] = [];
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/collections"), {
      next: { revalidate, tags: STOREFRONT_TAGS },
    });
    if (res.ok) collections = ((await res.json()) as { items: Collection[] }).items;
  } catch {
    collections = [];
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <h1 className="mb-2 text-3xl font-semibold text-ink">Shop by Space</h1>
      <p className="mb-8 text-ink-secondary">
        Collections curated for Philippine small homes — every corner useful.
      </p>

      {collections.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-8 text-center text-ink-secondary">
          No collections yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {collections.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </div>
      )}
    </div>
  );
}
