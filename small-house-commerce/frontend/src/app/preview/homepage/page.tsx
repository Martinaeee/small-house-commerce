import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SECTION_REGISTRY } from "@/components/home/sectionRegistry";
import { PreviewStorefrontShell } from "@/components/admin/homepage/PreviewStorefrontShell";
import {
  serverApiUrl,
  type AnnouncementBlockView,
  type HomepageResponse,
  type HomepageSection,
} from "@/lib/api";
import { loadHomepagePreviewShellData } from "@/lib/homepage-preview-shell-data";

/**
 * Operator-only draft preview of the homepage document (spec §5.2 / Task 21).
 *
 * Deliberately lives OUTSIDE the `(storefront)` group so it inherits neither
 * the storefront layout (MetaPixelInit, Header/Footer, AnnouncementBar wiring)
 * nor the home page's HomeTracking delegation: this route must fire ZERO
 * tracking. The only tracking-shaped thing that survives is the `data-track-*`
 * attributes baked into section components — without the delegation they are
 * inert.
 *
 * Gate: the URL carries `?token=…`; a missing, empty, whitespace-only, repeated,
 * malformed, expired, wrong-scope, or stale-revision token 404s. The backend
 * applies the cryptographic and revision checks; this page treats either
 * preview fetch returning non-200 as the same not-found outcome.
 *
 * Hygiene: the token only ever appears in the server-side fetch URL. It is
 * never rendered, logged, or persisted (no cookie / localStorage /
 * sessionStorage), and `Referrer-Policy: no-referrer` (next.config headers)
 * keeps it out of outbound Referer headers.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PreviewData {
  sections: HomepageSection[];
  announcement: AnnouncementBlockView | null;
}

/** Reads the announcement body with the storefront convention: empty 200 = null. */
async function parseAnnouncement(res: Response): Promise<AnnouncementBlockView | null> {
  const body = await res.text();
  if (body.trim() === "") return null;
  try {
    return (JSON.parse(body) as AnnouncementBlockView | null) ?? null;
  } catch {
    // The bar is enhancement (same contract as the storefront layout): a
    // malformed body hides it rather than failing the whole preview.
    return null;
  }
}

/**
 * Token-gated preview fetch pair. Returns null for every "cannot render the
 * draft" outcome — a non-200 answer (including the backend's uniform 404 for
 * an invalid token) or a network error — which the page turns into the same
 * 404. `cache: "no-store"` keeps both requests out of the fetch cache (a
 * preview must never be served stale).
 */
async function fetchPreview(token: string): Promise<PreviewData | null> {
  try {
    const [homepageRes, announcementRes] = await Promise.all([
      fetch(
        serverApiUrl(`/api/v1/storefront/homepage?previewToken=${encodeURIComponent(token)}`),
        { cache: "no-store" },
      ),
      fetch(
        serverApiUrl(`/api/v1/storefront/announcement?previewToken=${encodeURIComponent(token)}`),
        { cache: "no-store" },
      ),
    ]);
    if (!homepageRes.ok || !announcementRes.ok) return null;

    const homepage = (await homepageRes.json()) as HomepageResponse;
    const sections = Array.isArray(homepage.sections) ? homepage.sections : [];
    return { sections, announcement: await parseAnnouncement(announcementRes) };
  } catch {
    return null;
  }
}

export default async function HomepagePreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawToken = params.token;
  // Only a single non-blank string is a token. Anything else (absent, empty,
  // whitespace-only, repeated params) is the missing/empty case and 404s
  // before any fetch.
  if (typeof rawToken !== "string" || rawToken.trim() === "") notFound();

  const [data, shellData] = await Promise.all([
    fetchPreview(rawToken),
    loadHomepagePreviewShellData({ urlFor: serverApiUrl }),
  ]);
  if (!data) notFound();

  // Same mapping/props as the storefront home page (minus its tracking, the
  // RecentlyViewed slot and the JSON-LD block, none of which belong on a
  // draft preview). Unknown section types are dropped exactly like `/`.
  const sections = data.sections.filter((section) =>
    Boolean(SECTION_REGISTRY[section.type]),
  );

  return (
    <>
      <div
        data-draft-preview-banner
        className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-black"
      >
        草稿预览 · 未发布
      </div>
      {/* Spacer matching the fixed banner's height (py-2 + text-xs line-height
          = 32px = h-8) so it never covers the announcement bar. */}
      <div aria-hidden className="h-8" />
      <PreviewStorefrontShell
        shell={shellData.shell}
        roots={shellData.roots}
        collections={shellData.collections}
        settings={shellData.settings}
        announcement={data.announcement}
      >
        {sections.map((section) => {
          const SectionComponent = SECTION_REGISTRY[section.type];
          if (!SectionComponent) return null;
          return (
            <div key={section.id} data-preview-section-id={section.id}>
              <SectionComponent section={section} interactionMode="preview" />
            </div>
          );
        })}
      </PreviewStorefrontShell>
    </>
  );
}
