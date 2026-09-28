import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { MetaPixelInit } from "@/components/tracking/MetaPixelInit";
import { Providers } from "@/components/auth/Providers";
import { MessengerChat } from "@/components/chat/MessengerChat";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { BackToTop } from "@/components/layout/BackToTop";
import { buildNav } from "@/lib/nav";
import {
  getAnnouncement,
  serverApiUrl,
  type AnnouncementBlockView,
  type Category,
  type Collection,
} from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { DEFAULT_SITE_SETTINGS, fetchSiteSettings, type SiteSettings } from "@/lib/site-settings";

async function getLayoutData(): Promise<{
  roots: Category[];
  collections: Collection[];
  settings: SiteSettings;
}> {
  try {
    const [categoriesRes, collectionsRes, settings] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/categories"), { next: { revalidate: 300, tags: STOREFRONT_TAGS } }),
      // All ACTIVE collections: buildNav only surfaces flat links whose backing
      // collection exists; the footer receives the NAVIGATION slice.
      fetch(serverApiUrl("/api/v1/storefront/collections"), { next: { revalidate: 300, tags: STOREFRONT_TAGS } }),
      fetchSiteSettings(),
    ]);
    const roots = categoriesRes.ok ? ((await categoriesRes.json()) as Category[]) : [];
    const collections = collectionsRes.ok
      ? ((await collectionsRes.json()) as { items: Collection[] }).items
      : [];
    return { roots, collections, settings };
  } catch {
    // Navigation is enhancement; a backend outage must not blank the site.
    return { roots: [], collections: [], settings: DEFAULT_SITE_SETTINGS };
  }
}

async function getAnnouncementData(): Promise<AnnouncementBlockView | null> {
  try {
    return await getAnnouncement();
  } catch {
    // The announcement bar is enhancement; a backend outage must not blank
    // the site (the bar simply does not render).
    return null;
  }
}

export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ roots, collections, settings }, announcement] = await Promise.all([
    getLayoutData(),
    getAnnouncementData(),
  ]);
  const navItems = buildNav(roots, collections);
  const footerCollections = collections.filter((c) => c.type === "NAVIGATION");

  return (
    <Providers settings={settings}>
      <MetaPixelInit />
      <AnnouncementBar data={announcement} />
      <Header navItems={navItems} />
      <main className="flex-1">{children}</main>
      <Footer
        collections={footerCollections}
        supportEmail={settings.supportEmail}
        supportHours={settings.supportHours}
      />
      <CartDrawer />
      <MessengerChat />
      <MobileTabBar />
      <BackToTop />
    </Providers>
  );
}
