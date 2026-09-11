/**
 * Site-wide announcement bar (HOMEPAGE_SPEC §5.1). Sits above the sticky
 * header on every page and scrolls away with the page.
 */
export const ANNOUNCEMENT =
  "Free Metro Manila delivery on orders ₱3,000+ · Cash on Delivery nationwide";

export function AnnouncementBar() {
  return (
    <div className="bg-cta px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">
      {ANNOUNCEMENT}
    </div>
  );
}
