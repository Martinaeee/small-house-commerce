import { Suspense } from "react";
import { MarketingTouchObserver } from "@/components/tracking/MarketingTouchObserver";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { BackToTop } from "@/components/layout/BackToTop";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { StorefrontShellPresentation } from "@/components/layout/StorefrontShellPresentation";
import { MetaPixelInit } from "@/components/tracking/MetaPixelInit";
import { Providers } from "@/components/auth/Providers";
import { MessengerChat } from "@/components/chat/MessengerChat";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { NewsletterPopup } from "@/components/newsletter/NewsletterPopup";
import { serverApiUrl, getAnnouncement, type AnnouncementBlockView, type Category, type Collection } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { fetchSiteSettings, type SiteSettings } from "@/lib/site-settings";
import {
  fetchStorefrontShell,
  materializeDefaultStorefrontShell,
  storefrontThemeStyle,
} from "@/lib/storefront-shell";
import type { PublicStorefrontShell } from "@/lib/storefront-shell-api";

async function getCatalogData(): Promise<{
  roots: Category[];
  collections: Collection[];
}> {
  try {
    const [categoriesResponse, collectionsResponse] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/categories"), {
        next: { revalidate: 300, tags: STOREFRONT_TAGS },
      }),
      fetch(serverApiUrl("/api/v1/storefront/collections"), {
        next: { revalidate: 300, tags: STOREFRONT_TAGS },
      }),
    ]);
    const roots = categoriesResponse.ok
      ? ((await categoriesResponse.json()) as Category[])
      : [];
    const collections = collectionsResponse.ok
      ? ((await collectionsResponse.json()) as { items: Collection[] }).items
      : [];
    return { roots, collections };
  } catch {
    return { roots: [], collections: [] };
  }
}

async function getLayoutData(): Promise<{
  roots: Category[];
  collections: Collection[];
  settings: SiteSettings;
  shell: PublicStorefrontShell;
}> {
  const [catalog, settings, fetchedShell] = await Promise.all([
    getCatalogData(),
    fetchSiteSettings(),
    fetchStorefrontShell(),
  ]);
  return {
    ...catalog,
    settings,
    shell: materializeDefaultStorefrontShell(
      fetchedShell,
      catalog.roots,
      catalog.collections,
      settings,
    ),
  };
}

async function getAnnouncementData(): Promise<AnnouncementBlockView | null> {
  try {
    return await getAnnouncement();
  } catch {
    // The announcement bar is enhancement; a backend outage must not blank
    // the storefront.
    return null;
  }
}

export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ roots, collections, settings, shell }, announcement] = await Promise.all([
    getLayoutData(),
    getAnnouncementData(),
  ]);

  return (
    <Providers settings={settings}>
      <style
        id="storefront-theme-tokens"
        dangerouslySetInnerHTML={{ __html: storefrontThemeStyle(shell) }}
      />
      <Suspense fallback={null}>
        <MarketingTouchObserver />
      </Suspense>
      <MetaPixelInit />
      <div className="storefront-app flex min-h-full flex-1 flex-col">
        <AnnouncementBar data={announcement} />
        <StorefrontShellPresentation
          shell={shell}
          roots={roots}
          collections={collections}
          mode="live"
          supportPhone={settings.supportPhone}
        >
          {children}
        </StorefrontShellPresentation>
        <CartDrawer />
        <NewsletterPopup />
        <MessengerChat />
        <MobileTabBar />
        <BackToTop />
      </div>
    </Providers>
  );
}
