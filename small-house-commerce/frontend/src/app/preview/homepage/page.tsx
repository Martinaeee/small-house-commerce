import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomepageAppearance } from "@/components/home/HomepageAppearance";
import { SECTION_REGISTRY } from "@/components/home/sectionRegistry";
import { PreviewStorefrontShell } from "@/components/admin/homepage/PreviewStorefrontShell";
import { HomepagePreviewViewport } from "@/components/admin/homepage/HomepagePreviewViewport";
import {
  serverApiUrl,
  type AnnouncementBlockView,
  type HomepageResponse,
} from "@/lib/api";
import { loadHomepagePreviewShellData } from "@/lib/homepage-preview-shell-data";

// Signed preview stays outside storefront providers; only the same-origin frame src carries its token.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PreviewData extends HomepageResponse {
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
    return {
      sections,
      ...(homepage.appearance === "STUDIO_V3" ? { appearance: homepage.appearance } : {}),
      announcement: await parseAnnouncement(announcementRes),
    };
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

  const view = params.view;
  if (view !== undefined && view !== "desktop" && view !== "tablet" && view !== "mobile" && view !== "content") notFound();

  const data = await fetchPreview(rawToken);
  if (!data) notFound();
  if (view === "desktop" || view === "tablet" || view === "mobile") {
    const query = new URLSearchParams({ token: rawToken, view: "content" });
    return <HomepagePreviewViewport view={view} src={`/preview/homepage?${query}`} />;
  }
  const shellData = await loadHomepagePreviewShellData({ urlFor: serverApiUrl });

  // Same mapping/props as the storefront home page (minus its tracking, the
  // RecentlyViewed slot and the JSON-LD block, none of which belong on a
  // draft preview). Unknown section types are dropped exactly like `/`.
  const sections = data.sections.filter((section) =>
    Boolean(SECTION_REGISTRY[section.type]),
  );

  return (
    <>
      {view === undefined ? <>
        <div data-draft-preview-banner
          className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-black">
          草稿预览 · 未发布
        </div>
        <div aria-hidden className="h-8" />
      </> : null}
      <PreviewStorefrontShell
        shell={shellData.shell}
        roots={shellData.roots}
        collections={shellData.collections}
        settings={shellData.settings}
        announcement={data.announcement}
      >
        <HomepageAppearance appearance={data.appearance}>
        {sections.map((section) => {
          const SectionComponent = SECTION_REGISTRY[section.type];
          if (!SectionComponent) return null;
          return (
            <div key={section.id} data-preview-section-id={section.id} data-homepage-section-type={section.type}>
              <SectionComponent section={section} appearance={data.appearance} interactionMode="preview" />
            </div>
          );
        })}
        </HomepageAppearance>
      </PreviewStorefrontShell>
    </>
  );
}
