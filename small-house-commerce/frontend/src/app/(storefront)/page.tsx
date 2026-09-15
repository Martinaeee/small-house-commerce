import { DEFAULT_SECTIONS } from "@/components/home/default-sections";
import { HomeTracking } from "@/components/home/HomeTracking";
import { SECTION_REGISTRY } from "@/components/home/sectionRegistry";
import { getHomepage } from "@/lib/api";

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

  return (
    <>
      <HomeTracking />
      {sections.map((section) => {
        const SectionComponent = SECTION_REGISTRY[section.type];
        return <SectionComponent key={section.id} section={section} />;
      })}
      {/* Task 7 inserts <RecentlyViewed /> before the first sortOrder >= 100 section. */}
    </>
  );
}
