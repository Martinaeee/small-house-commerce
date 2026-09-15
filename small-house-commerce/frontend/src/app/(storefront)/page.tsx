import type { Metadata } from "next";
import { DEFAULT_SECTIONS } from "@/components/home/default-sections";
import { HomeTracking } from "@/components/home/HomeTracking";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
import { SECTION_REGISTRY } from "@/components/home/sectionRegistry";
import { getHomepage } from "@/lib/api";
import { buildHomeJsonLd } from "@/lib/home-jsonld";

// absolute bypasses the root "%s | LUWAG Living" template (avoids a double suffix).
export const metadata: Metadata = {
  title: { absolute: "Small-Space & Condo Furniture Philippines | LUWAG Living" },
  description:
    "Small space furniture for condos and rentals in the Philippines — beds, desks, storage and foldable pieces. Cash on delivery, nationwide shipping.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Small Space. Big Luwag. | LUWAG Living",
    description:
      "Furniture designed for condos, rentals and everyday small-space living. Cash on delivery, nationwide shipping in the Philippines.",
    url: "/",
    siteName: "LUWAG Living",
    type: "website",
  },
};

// ISR revalidation is configured inside getHomepage (revalidate: 120 + tags).
export default async function HomePage() {
  let sections;
  try {
    const response = await getHomepage();
    // Empty table (seed not run yet) -> use the built-in composition rather
    // than a blank page.
    sections = response.sections.length > 0 ? response.sections : DEFAULT_SECTIONS;
  } catch {
    sections = DEFAULT_SECTIONS;
  }

  // IA slot 13: Recently Viewed sits before the first footer-ish (sortOrder >= 100)
  // section; when no such section exists it appends after everything.
  const rvIndex = sections.findIndex((section) => section.sortOrder >= 100);

  return (
    <>
      <HomeTracking />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildHomeJsonLd()) }}
      />
      {sections.map((section, index) => {
        const SectionComponent = SECTION_REGISTRY[section.type];
        if (!SectionComponent) return null;
        return (
          <div key={section.id}>
            {index === rvIndex ? <RecentlyViewed /> : null}
            <SectionComponent section={section} />
          </div>
        );
      })}
      {rvIndex === -1 ? <RecentlyViewed /> : null}
    </>
  );
}
