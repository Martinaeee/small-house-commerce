import type { ReactNode } from "react";

/**
 * Minimal shape shared by the API rows and the admin form's strings, so this
 * one component can render both the live PDP and the admin preview — what the
 * merchant previews is literally what ships.
 */
export interface DetailBlockLike {
  type: "IMAGE" | "VIDEO";
  url: string;
  altText?: string | null;
}

/**
 * PDP description body, shown below the gallery.
 *
 * `description` stays as the short text intro; the blocks are the long
 * image/video deck suppliers ship with the product, so the section is
 * media-first by design.
 */
export function ProductDetailBody({
  description,
  blocks,
}: {
  description?: string | null;
  blocks: DetailBlockLike[];
}): ReactNode {
  const intro = description?.trim() ?? "";
  const media = blocks.filter((block) => block.url.trim() !== "");
  if (!intro && media.length === 0) return null;

  return (
    <div id="details" className="scroll-mt-28">
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
        {intro ? (
          <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
            {intro}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            See the images and video below for full product details.
          </p>
        )}
      </div>

      {media.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          {media.map((block, index) =>
            block.type === "VIDEO" ? (
              <video
                key={`${block.url}-${index}`}
                className="w-full rounded-lg border border-border bg-black"
                controls
                playsInline
                preload="metadata"
                // Never autoplay: these are long supplier clips and most
                // shoppers are on metered mobile data.
              >
                <source src={block.url} />
                {block.altText ?? "Product video"}
              </video>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${block.url}-${index}`}
                src={block.url}
                alt={block.altText ?? ""}
                loading="lazy"
                className="w-full rounded-lg border border-border"
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
