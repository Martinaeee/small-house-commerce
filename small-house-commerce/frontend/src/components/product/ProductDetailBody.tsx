import type { ReactNode } from "react";
import { visibleFeatureLines } from "@/lib/feature-lines";
import type { DetailBlockLike } from "./pdp-detail-blocks";
import { ViewportVideo } from "./ViewportVideo";

export type { DetailBlockLike } from "./pdp-detail-blocks";

function DetailMedia({
  block,
  index,
  fullBleed,
}: {
  block: DetailBlockLike;
  index: number;
  fullBleed: boolean;
}): ReactNode {
  const frame = fullBleed
    ? "-mx-4 w-[calc(100%+2rem)] max-w-none sm:mx-0 sm:w-full"
    : "w-full";
  if (block.type === "VIDEO") {
    return (
      <ViewportVideo
        src={block.url}
        mode="CONTENT"
        ariaLabel={block.altText ?? "Product detail video"}
        className={`${frame} bg-black`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={block.url}
      alt={block.altText ?? ""}
      loading="lazy"
      className={`${frame} block`}
      data-detail-index={index}
    />
  );
}

export function ProductDetailMedia({
  blocks,
  fullBleed = false,
}: {
  blocks: readonly DetailBlockLike[];
  /** Phones: run each image edge to edge. The images themselves are stitched. */
  fullBleed?: boolean;
}): ReactNode {
  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col">
      {blocks.map((block, index) => (
        <DetailMedia
          key={`${block.url}-${block.type}-${index}`}
          block={block}
          index={index}
          fullBleed={fullBleed}
        />
      ))}
    </div>
  );
}

export function ProductDetailBody({
  description,
  features,
  highlightsVisible = true,
  featured = null,
  blocks,
}: {
  description?: string | null;
  features?: string | null;
  /** Whole-block switch authored in the admin form; off hides every bullet. */
  highlightsVisible?: boolean;
  featured?: DetailBlockLike | null;
  /** Compatibility input for the existing Admin live preview. */
  blocks?: readonly DetailBlockLike[];
}): ReactNode {
  const intro = description?.trim() ?? "";
  const highlights = highlightsVisible ? visibleFeatureLines(features) : [];
  const leadMedia = blocks
    ? blocks.filter((block) => block.url.trim() !== "")
    : featured
      ? [featured]
      : [];

  if (!intro && highlights.length === 0 && leadMedia.length === 0) return null;

  return (
    <section id="details" className="flex scroll-mt-32 flex-col gap-4">
      {intro ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
            {intro}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col">
        {highlights.length > 0 ? (
          <div className="pb-6">
            <h2 className="mb-3 text-2xl font-semibold text-ink">
              Why You’ll Love It
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {highlights.map((highlight, index) => (
                <li
                  key={`${highlight}-${index}`}
                  className="flex items-start gap-2 text-base leading-relaxed text-ink-secondary"
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
      </div>
    </section>
  );
}
