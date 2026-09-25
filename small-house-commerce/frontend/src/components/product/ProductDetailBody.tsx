import type { ReactNode } from "react";
import type { DetailBlockLike } from "./pdp-detail-blocks";

export type { DetailBlockLike } from "./pdp-detail-blocks";

function DetailMedia({
  block,
  index,
}: {
  block: DetailBlockLike;
  index: number;
}): ReactNode {
  if (block.type === "VIDEO") {
    return (
      <video
        className="w-full rounded-lg border border-border bg-black"
        controls
        playsInline
        preload="metadata"
        aria-label={block.altText ?? "Product detail video"}
      >
        <source src={block.url} />
        {block.altText ?? "Product video"}
      </video>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={block.url}
      alt={block.altText ?? ""}
      loading="lazy"
      className="w-full rounded-lg border border-border"
      data-detail-index={index}
    />
  );
}

export function ProductDetailMedia({
  blocks,
}: {
  blocks: readonly DetailBlockLike[];
}): ReactNode {
  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => (
        <DetailMedia
          key={`${block.url}-${block.type}-${index}`}
          block={block}
          index={index}
        />
      ))}
    </div>
  );
}

export function ProductDetailBody({
  description,
  features,
  featured = null,
  blocks,
}: {
  description?: string | null;
  features?: string | null;
  featured?: DetailBlockLike | null;
  /** Compatibility input for the existing Admin live preview. */
  blocks?: readonly DetailBlockLike[];
}): ReactNode {
  const intro = description?.trim() ?? "";
  const highlights = (features ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const leadMedia = blocks
    ? blocks.filter((block) => block.url.trim() !== "")
    : featured
      ? [featured]
      : [];

  if (!intro && highlights.length === 0 && leadMedia.length === 0) return null;

  return (
    <section id="details" className="scroll-mt-28 space-y-4">
      {intro ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
            {intro}
          </p>
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-2xl font-semibold text-ink">
            Why You’ll Love It
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {highlights.map((highlight, index) => (
              <li
                key={`${highlight}-${index}`}
                className="flex items-start gap-2 text-sm leading-relaxed text-ink-secondary"
              >
                <span aria-hidden className="mt-0.5 font-semibold text-cta">
                  ✓
                </span>
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ProductDetailMedia blocks={leadMedia} />
    </section>
  );
}
