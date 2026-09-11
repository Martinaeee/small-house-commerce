import Link from "next/link";
import type { Collection } from "@/lib/api";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";

/**
 * DESIGN_SYSTEM §14 Collection Card — homepage navigation modules.
 * Structure: image → name → short description.
 */
export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group block overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md"
    >
      {collection.heroImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={collection.heroImage}
          alt={collection.name}
          className="aspect-[4/5] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <PlaceholderImage label={collection.name} className="aspect-[4/5] w-full" />
      )}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-ink group-hover:text-cta">
          {collection.name}
        </h3>
        {collection.description && (
          <p className="mt-1 line-clamp-2 text-xs text-ink-secondary">
            {collection.description}
          </p>
        )}
      </div>
    </Link>
  );
}
