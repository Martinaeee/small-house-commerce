import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell, SmartLink } from "./sectionShell";
import { poppinsMedium, storySerif } from "@/lib/fonts";
import type { SectionProps } from "./sectionRegistry";
import { optimizedUploadImage } from "@/lib/image-url";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The brand story is the one section that talks instead of sells: a single
 * brand image beside the brand copy (eyebrow / heading / body / CTA). It
 * deliberately carries no product list — the homepage already has grids,
 * product stories and room galleries for that.
 *
 * Geometry is transcribed from the approved mockup (1672×941 artboard):
 * the photo takes 57.7% of the width and every vertical pixel of the block,
 * the copy sits on a warm off-white panel in the remaining 42.3%. The
 * artboard also fixes the type: heading and body in Prata (see `storySerif`),
 * the eyebrow and CTA in letter-spaced Poppins. Every size below is the
 * mockup's own value converted to `cqw` of the block's width — the ink
 * positions were verified pixel-for-pixel against the mockup at 1672px wide
 * (eyebrow 246, heading 311, body 527, CTA 704).
 *
 * The block is NOT full-bleed: it sits in the storefront's usual 1200px
 * content column so it lines up with the sections around it. The mockup
 * draws the photo touching the artboard's left edge, but on the real page
 * that edge would break the grid; the photo keeps filling its column and
 * the artboard simply scales down with the container.
 *
 * Because the layout is an artboard, the copy sizes are expressed in `cqw`
 * against the block's own width rather than in viewport units: the admin
 * preview renders this section at a simulated 1440px inside a normal browser
 * window, where `vw` would measure the wrong thing. Below 900px the section
 * stops being an artboard and stacks into a 4:3 photo over a padded copy
 * block sized in ordinary px.
 */
export function BrandStorySection({ section, previewDevice }: SectionProps) {
  const p = section.payload ?? {};
  const image = str(p.imageUrl);
  const imageAlt = str(p.imageAlt);
  const eyebrow = str(p.eyebrow);
  const heading = str(p.heading) || section.title || "";
  const title = section.title && section.title !== heading ? section.title : "About LUWAG";
  const body = str(p.body);
  const ctaText = str(p.ctaText);
  const ctaLink = str(p.ctaLink);
  // Legacy: BRAND_STORY used to share CONFIDENCE's bullet list. The backend
  // still accepts it, so an older published section keeps rendering its
  // bullets instead of losing them.
  const bullets = Array.isArray(p.bullets)
    ? p.bullets.map((bullet) => str(bullet)).filter(Boolean)
    : [];

  if (!image && !eyebrow && !heading && !body) {
    return (
      <SectionPlaceholder
        title={section.title}
        message="Brand story coming soon."
        style={section.style}
        previewDevice={previewDevice}
      />
    );
  }

  // In the admin preview the device is known up front, so the layout is fixed
  // instead of left to media queries — a 390px preview inside a 1440px browser
  // would otherwise still get the desktop split. Only the desktop frame keeps
  // the two-column artboard; the 768px tablet frame stacks exactly like the
  // live site does below 900px. With no preview device the live breakpoints
  // decide.
  const widePreview = previewDevice === "desktop";
  const stackedPreview = previewDevice === "tablet" || previewDevice === "mobile";

  const layoutClass = [
    "grid w-full grid-cols-1 [container-type:inline-size] overflow-hidden rounded-lg border border-border bg-card",
    stackedPreview
      ? ""
      : widePreview
        ? "aspect-[1672/941] grid-cols-[57.7%_42.3%]"
        : "min-[900px]:aspect-[1672/941] min-[900px]:grid-cols-[57.7%_42.3%]",
  ]
    .filter(Boolean)
    .join(" ");

  const mediaClass = [
    "relative min-w-0 overflow-hidden",
    stackedPreview ? "aspect-[4/3]" : widePreview ? "" : "aspect-[4/3] min-[900px]:aspect-auto",
  ]
    .filter(Boolean)
    .join(" ");

  const copyClass = [
    "flex min-w-0 flex-col justify-center",
    stackedPreview
      ? "px-6 py-12"
      : widePreview
        ? "justify-start pt-[14.25cqw] pr-[3.11cqw] pl-[4.7cqw]"
        : "px-6 py-12 min-[900px]:justify-start min-[900px]:py-0 min-[900px]:pt-[14.25cqw] min-[900px]:pr-[3.11cqw] min-[900px]:pl-[4.7cqw]",
  ].join(" ");

  const eyebrowClass = [
    poppinsMedium.className,
    "uppercase text-[var(--color-story-kicker)]",
    stackedPreview
      ? "text-[11px] leading-[1.6] tracking-[0.18em]"
      : widePreview
        ? "text-[1.196cqw] leading-[1.5] tracking-[0.21em]"
        : "text-[11px] leading-[1.6] tracking-[0.18em] min-[900px]:text-[1.196cqw] min-[900px]:leading-[1.5] min-[900px]:tracking-[0.21em]",
  ].join(" ");

  const headingClass = [
    storySerif.className,
    "whitespace-pre-line text-[var(--color-story-heading)]",
    stackedPreview
      ? "mt-[14px] text-[32px] leading-[1.16]"
      : widePreview
        ? "mt-[2.02cqw] text-[4.127cqw] leading-[1.246]"
        : "mt-[14px] text-[32px] leading-[1.16] min-[900px]:mt-[2.02cqw] min-[900px]:text-[4.127cqw] min-[900px]:leading-[1.246]",
  ].join(" ");

  const bodyClass = [
    storySerif.className,
    "text-[var(--color-story-body)]",
    // The mockup's body breaks are a desktop artifact: on a narrow column they
    // fight the layout and leave an orphan line, so mobile lets the copy flow
    // and only the artboard keeps the authored breaks.
    stackedPreview
      ? "mt-[20px] whitespace-normal text-[15px] leading-[1.65]"
      : widePreview
        ? "mt-[2.72cqw] whitespace-pre-line text-[1.57cqw] leading-[1.6]"
        : "mt-[20px] whitespace-normal text-[15px] leading-[1.65] min-[900px]:mt-[2.72cqw] min-[900px]:whitespace-pre-line min-[900px]:text-[1.57cqw] min-[900px]:leading-[1.6]",
  ].join(" ");

  const ctaClass = [
    poppinsMedium.className,
    "inline-flex w-fit items-center gap-[0.5em] border-b border-[var(--color-story-link-border)] pb-[0.05em] text-[var(--color-story-link)] tracking-[0.02em] hover:opacity-70",
    stackedPreview
      ? "mt-[26px] text-[13px]"
      : widePreview
        ? "mt-[3.02cqw] text-[1.22cqw]"
        : "mt-[26px] text-[13px] min-[900px]:mt-[3.02cqw] min-[900px]:text-[1.22cqw]",
  ].join(" ");

  // The legacy bullet list only exists on sections published before the split
  // layout, so it keeps the artboard's own scale on the desktop board and
  // ordinary pixels in the stacked layout.
  const bulletsClass = [
    "flex list-none flex-col pl-0 text-[var(--color-story-body)]",
    stackedPreview
      ? "mt-[18px] gap-[8px] text-[14px] leading-[1.6]"
      : widePreview
        ? "mt-[2.4cqw] gap-[0.9cqw] text-[1.24cqw] leading-[1.6]"
        : "mt-[18px] gap-[8px] text-[14px] leading-[1.6] min-[900px]:mt-[2.4cqw] min-[900px]:gap-[0.9cqw] min-[900px]:text-[1.24cqw] min-[900px]:leading-[1.6]",
  ].join(" ");

  const bulletItemClass = "flex items-start gap-[0.7em]";

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <SectionHeading title={title} subtitle={section.subtitle} />
      <div data-brand-story-layout className={layoutClass}>
        <div data-brand-story-media data-homepage-role="brand-story-media" className={mediaClass}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={optimizedUploadImage(image, 1440)}
              alt={imageAlt || heading}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <PlaceholderImage label={heading} className="h-full w-full" />
          )}
        </div>
        <div data-brand-story-copy className={copyClass}>
          {eyebrow ? <p className={eyebrowClass}>{eyebrow}</p> : null}
          {heading ? (
            <h2 data-homepage-role="brand-story-heading" className={headingClass}>
              {heading}
            </h2>
          ) : null}
          {body ? (
            <p data-homepage-role="brand-story-body" className={bodyClass}>
              {body}
            </p>
          ) : null}
          {bullets.length > 0 ? (
            <ul data-homepage-role="brand-story-list" className={bulletsClass}>
              {bullets.slice(0, 6).map((bullet, index) => (
                <li key={index} className={bulletItemClass}>
                  <span aria-hidden="true" className="text-[var(--color-story-kicker)]">
                    ✓
                  </span>
                  {bullet}
                </li>
              ))}
            </ul>
          ) : null}
          {/* A CTA without a destination is not a link — same rule as the
              product story and the banner bodies. */}
          {ctaLink && ctaText ? (
            <SmartLink
              href={ctaLink}
              data-homepage-role="brand-story-action"
              className={ctaClass}
            >
              <span>{ctaText}</span>
              <span aria-hidden="true">↗</span>
            </SmartLink>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
