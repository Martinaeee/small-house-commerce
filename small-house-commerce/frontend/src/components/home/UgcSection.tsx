"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { Product } from "@/lib/api";
import type { SectionProps } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";
import { readUgcPayload } from "@/lib/homepage-section-normalize";
import { HomepageContentImage } from "./HomepageContentImage";
import styles from "./UgcSection.module.css";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
type CollageEntry = { id?: string; name?: string; location?: string; comment?: string; imageUrl?: string; product?: Product };

function subscribeMobile(callback: () => void) {
  const media = window.matchMedia("(max-width: 767.98px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const mobileSnapshot = () => window.matchMedia("(max-width: 767.98px)").matches;

function UgcCollage({ rows, featured, presentation, section, previewDevice, interactionMode }: SectionProps & {
  rows: CollageEntry[];
  featured: CollageEntry;
  presentation: NonNullable<ReturnType<typeof readUgcPayload>["presentation"]>;
}) {
  const smallViewport = useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false);
  const mobile = previewDevice ? previewDevice === "mobile" : smallViewport;
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [pan, setPan] = useState({ left: 0, max: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; left: number; moved: boolean } | null>(null);
  const readerId = useId();
  const supporting = rows.filter((entry) => entry !== featured);
  const attribution = [str(featured.name).trim(), str(featured.location).trim()].filter(Boolean).join(" · ");
  const quote = str(featured.comment);
  const showQuote = presentation.showQuote !== false && quote.trim() !== "";

  useEffect(() => {
    const host = viewport.current!;
    let active = true;
    const update = () => {
      if (!active) return;
      const text = measure.current;
      if (text) {
        const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight) || 26;
        setOverflowing(text.scrollHeight > lineHeight * 2 + 1);
      }
      const max = Math.max(0, host.scrollWidth - host.clientWidth);
      const left = Math.max(0, Math.min(max, host.scrollLeft));
      setPan((previous) => previous.max === max && previous.left === left ? previous : { max, left });
    };
    const resize = new ResizeObserver(update);
    resize.observe(host);
    if (measure.current) resize.observe(measure.current);
    host.addEventListener("scroll", update, { passive: true });
    update();
    void document.fonts?.ready.then(update);
    return () => { active = false; resize.disconnect(); host.removeEventListener("scroll", update); };
  }, [quote, showQuote, mobile, rows.length]);

  useEffect(() => {
    if (open) {
      reader.current?.focus({ preventScroll: true });
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      expand.current?.focus({ preventScroll: true });
    }
  }, [open]);

  const collapse = () => { restoreFocus.current = true; setOpen(false); };
  const scrollTo = (left: number) => {
    viewport.current?.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  const photo = (entry: CollageEntry) => <>
    {entry.imageUrl ? <HomepageContentImage src={entry.imageUrl} className={styles.photo} /> : <PlaceholderImage label="" className={styles.photo} />}
    {entry.product?.slug ? <Link
      href={`/products/${encodeURIComponent(entry.product.slug)}`}
      aria-label={`View ${entry.product.name} from ${str(entry.name).trim() || "this home photo"}`}
      className={styles.photoLink}
      data-ugc-photo-link
      draggable={false}
      onClick={interactionMode === "preview" ? (event) => event.preventDefault() : undefined}
      {...(interactionMode === "preview" ? {} : trackAttrs("ProductClick", section, rows.indexOf(entry) + 1))}
    >
      <span className={styles.photoBadge} data-ugc-photo-badge hidden={open && showQuote}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2" /></svg>
        <span>View product</span>
      </span>
    </Link> : null}
  </>;
  const name = attribution && showQuote ? <p data-homepage-role="name" className={styles.attribution}>{attribution}</p> : null;
  const readingPanel = open && showQuote ? <div className={`${styles.readerPanel} ${presentation.overlay === "STRONG" ? styles.quoteStrong : ""}`} data-ugc-panel onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse(); } }}>
    <div className={styles.toolbar}>
      <button type="button" data-ugc-collapse onClick={collapse}>Show less</button>
      <span>Main photo</span>
      <button type="button" aria-label="Close quote" onClick={collapse}>×</button>
    </div>
    <div id={readerId} ref={reader} data-ugc-reader role="region" aria-label="Full quote" tabIndex={0}
      className={styles.reader} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse(); } }}>
      <blockquote data-homepage-role="quote">{quote}</blockquote>
    </div>
    {!mobile ? name : null}
  </div> : null;

  return <SectionShell style={section.style} previewDevice={previewDevice}>
    <SectionHeading title={section.title} subtitle={section.subtitle} />
    <div className={styles.collage} data-ugc-layout="collage" data-device={previewDevice} data-mobile={mobile} data-single={supporting.length === 0 ? "true" : undefined}>
      <div className={styles.stage}>
        <div ref={viewport} className={styles.viewport} data-ugc-viewport tabIndex={0} role="group" aria-label="Real home photos"
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest("figcaption")) return;
            gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, moved: false };
          }}
          onPointerMove={(event) => {
            const current = gesture.current;
            if (!current || current.id !== event.pointerId) return;
            const dx = event.clientX - current.x;
            const dy = event.clientY - current.y;
            if (Math.hypot(dx, dy) > 8) current.moved = true;
            if (event.pointerType === "mouse" && current.moved && Math.abs(dx) > Math.abs(dy) && pan.max > 0) {
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.scrollLeft = current.left - dx;
            }
          }}
          onPointerUp={() => { if (gesture.current) gesture.current.id = -1; }}
          onPointerCancel={() => { if (gesture.current) { gesture.current.id = -1; gesture.current.moved = true; } }}
          onClickCapture={(event) => {
            if (event.detail > 0 && gesture.current?.moved && (event.target as HTMLElement).closest("[data-ugc-photo-link]")) {
              event.preventDefault(); event.stopPropagation();
            }
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || pan.max <= 0) return;
            const next = event.key === "Home" ? 0 : event.key === "End" ? pan.max
              : event.key === "ArrowLeft" ? pan.left - 160 : event.key === "ArrowRight" ? pan.left + 160 : null;
            if (next !== null) { event.preventDefault(); scrollTo(next); }
          }}>
          <div className={styles.canvas} data-ugc-canvas>
            <figure data-homepage-role="media" className={styles.featured} data-ugc-featured data-ugc-entry-id={featured.id}>
              {photo(featured)}
              {showQuote ? <figcaption className={`${styles.quote} ${presentation.overlay === "STRONG" ? styles.quoteStrong : ""}`} data-open={open}>
                <span ref={measure} data-ugc-measure aria-hidden="true" className={styles.measure}>{quote}</span>
                {!open ? <>
                  {overflowing ? <button ref={expand} type="button" className={styles.summaryButton} data-ugc-expand aria-expanded="false" aria-controls={readerId}
                    aria-label="Read more of this quote" onClick={() => setOpen(true)}>
                    <span data-ugc-summary data-homepage-role="quote" className={styles.summary}>{quote}</span>
                    <span className={styles.more}>Read more</span>
                  </button> : <span data-ugc-summary data-homepage-role="quote" className={styles.summary}>{quote}</span>}
                  {!mobile ? name : null}
                </> : null}
              </figcaption> : null}
            </figure>
            {supporting.length > 0 ? <div className={styles.supporting} data-ugc-supporting data-count={supporting.length}>
              {supporting.map((entry) => <figure data-homepage-role="media" key={entry.id} data-ugc-entry-id={entry.id}>{photo(entry)}</figure>)}
            </div> : null}
          </div>
        </div>
        {readingPanel}
      </div>
      {pan.max > 1 ? <div className={styles.panControls}>
        <span>Swipe to explore</span>
        <button type="button" aria-label="Previous photos" disabled={pan.left <= 1} onClick={() => scrollTo(pan.left - 200)}>←</button>
        <button type="button" aria-label="Next photos" disabled={pan.left >= pan.max - 1} onClick={() => scrollTo(pan.left + 200)}>→</button>
      </div> : null}
      {mobile && name ? <div data-ugc-meta>{name}</div> : null}
    </div>
  </SectionShell>;
}

export function UgcSection({ section, previewDevice, interactionMode }: SectionProps) {
  const entries = Array.isArray(section.payload?.entries) ? section.payload.entries : [];
  const presentation = readUgcPayload(section.payload).presentation;
  if (presentation?.layout === "COLLAGE") {
    const rows = entries.slice(0, 6) as CollageEntry[];
    const featured = rows.find((entry) => entry.id === presentation.featuredEntryId);
    if (!featured) return null;
    return <UgcCollage key={featured.id} rows={rows} featured={featured} presentation={presentation} section={section} previewDevice={previewDevice} interactionMode={interactionMode} />;
  }
  const gridClass =
    previewDevice === "desktop"
      ? "grid grid-cols-3 gap-4"
      : previewDevice === "tablet"
        ? "grid grid-cols-2 gap-4"
        : previewDevice === "mobile"
          ? "grid grid-cols-1 gap-4"
          : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

  if (entries.length === 0) {
    return <SectionPlaceholder title={section.title} message="Real home photos coming soon." style={section.style} previewDevice={previewDevice} />;
  }

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      <div data-homepage-role="ugc-grid" className={gridClass}>
        {entries.slice(0, 6).map((entry, index) => {
          const row = entry as { imageUrl?: unknown; name?: unknown; location?: unknown; comment?: unknown; product?: Product };
          const image = str(row.imageUrl);
          return (
            <figure data-homepage-role="media" key={index} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : <PlaceholderImage label="" className="aspect-square w-full" />}
              <figcaption className="flex flex-1 flex-col gap-2 p-4">
                <blockquote data-homepage-role="quote" className="flex-1 text-sm text-ink-secondary">“{str(row.comment)}”</blockquote>
                <p data-homepage-role="name" className="text-sm font-semibold text-ink">
                  {str(row.name)}{str(row.location) ? <span className="font-normal text-ink-muted"> · {str(row.location)}</span> : null}
                </p>
                {row.product ? <Link href={`/products/${row.product.slug}`} {...trackAttrs("ProductClick", section, index + 1)}
                  className="text-sm font-semibold text-cta hover:underline">Shop {row.product.name}</Link> : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </SectionShell>
  );
}
