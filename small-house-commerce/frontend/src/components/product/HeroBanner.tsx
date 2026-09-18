import type { CSSProperties, ReactNode } from "react";
import { poppins } from "@/lib/fonts";
import type { HeroStyle } from "@/lib/api";

/**
 * Category / collection landing-page hero. One component for both (and for the
 * admin preview in step D), so what the merchant previews is what ships.
 *
 * The title is always centered — the merchant asked for that explicitly — and
 * every appearance knob comes from HeroStyle. An absent style renders the
 * plain centered name, which is what a page with no configuration gets.
 */

/** The only fonts the admin can choose from; no arbitrary webfont can load. */
const FONT_CLASS: Record<string, string> = {
  brand: poppins.className,
  sans: "",
  serif: "font-serif",
};

const DEFAULT_SIZE = 36;
const MIN_SIZE = 16;
const MAX_SIZE = 96;
const MAX_BLUR = 24;

/**
 * The API validates #rrggbb, but a hand-edited row must still not be able to
 * inject arbitrary CSS through an inline style.
 */
function safeColor(value: string | null | undefined): string | null {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

export function HeroBanner({
  name,
  style,
  fallbackImage,
}: {
  name: string;
  style?: HeroStyle | null;
  /**
   * Legacy path: `Category.imageUrl` used to BE the hero image. It still backs
   * the hero when no background is configured in the admin, so existing
   * categories keep their picture instead of silently losing it.
   */
  fallbackImage?: string | null;
}): ReactNode {
  const title = style?.titleOverride?.trim() || name;
  const explicitColor = safeColor(style?.titleColor);
  const size = Math.min(
    MAX_SIZE,
    Math.max(MIN_SIZE, style?.titleSize ?? DEFAULT_SIZE),
  );
  const fontClass = FONT_CLASS[style?.titleFont ?? "brand"] ?? FONT_CLASS.brand;
  const background = safeColor(style?.backgroundColor);
  const image =
    (style?.backgroundType === "IMAGE" ? style?.backgroundImageUrl : null) ??
    fallbackImage ??
    null;
  const blur = Math.min(MAX_BLUR, Math.max(0, style?.backgroundBlur ?? 0));

  // Over a photo the default ink text is unreadable, so white unless the
  // merchant picked a colour on purpose.
  const titleColor = explicitColor ?? (image ? "#ffffff" : null);
  const titleStyle: CSSProperties = {
    fontSize: `${size}px`,
    ...(titleColor ? { color: titleColor } : {}),
  };

  return (
    <section
      className={`relative mt-4 overflow-hidden rounded-lg ${image ? "" : "bg-card"}`}
      style={background ? { backgroundColor: background } : undefined}
    >
      {image ? (
        <>
          {/* The blur sits on its own layer so the title stays crisp, and the
              layer is scaled up so the blur cannot reveal the edges. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${JSON.stringify(image)})`,
              ...(blur > 0
                ? { filter: `blur(${blur}px)`, transform: "scale(1.12)" }
                : {}),
            }}
          />
          {/* Keeps the title legible over an arbitrary photo. */}
          <div aria-hidden className="absolute inset-0 bg-ink/30" />
        </>
      ) : null}

      <div
        className={`relative flex items-center justify-center px-4 ${
          image ? "min-h-[180px] py-10 sm:min-h-[220px]" : "py-7"
        }`}
      >
        <h1
          className={`text-center font-semibold leading-tight ${fontClass}`}
          style={titleStyle}
        >
          {title}
        </h1>
      </div>
    </section>
  );
}
