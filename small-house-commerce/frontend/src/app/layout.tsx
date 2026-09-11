import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { MetaPixelInit } from "@/components/tracking/MetaPixelInit";
import { buildNav } from "@/lib/nav";
import { serverApiUrl, type Category, type Collection } from "@/lib/api";

export const metadata: Metadata = {
  title: {
    default: "Small House PH — Smart Furniture for Small Homes",
    template: "%s | Small House PH",
  },
  description:
    "Space-saving furniture for Philippine small homes. Cash on delivery, nationwide delivery.",
};

async function getNavData(): Promise<{ roots: Category[]; collections: Collection[] }> {
  try {
    const [categoriesRes, collectionsRes] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/categories"), { next: { revalidate: 300 } }),
      // All ACTIVE collections: buildNav only surfaces flat links whose backing
      // collection exists; the footer receives the NAVIGATION slice.
      fetch(serverApiUrl("/api/v1/storefront/collections"), { next: { revalidate: 300 } }),
    ]);
    const roots = categoriesRes.ok ? ((await categoriesRes.json()) as Category[]) : [];
    const collections = collectionsRes
      ? ((await collectionsRes.json()) as { items: Collection[] }).items
      : [];
    return { roots, collections };
  } catch {
    // Navigation is enhancement; a backend outage must not blank the site.
    return { roots: [], collections: [] };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { roots, collections } = await getNavData();
  const navItems = buildNav(roots, collections);
  const footerCollections = collections.filter((c) => c.type === "NAVIGATION");

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <MetaPixelInit />
        <AnnouncementBar />
        <Header navItems={navItems} />
        <main className="flex-1">{children}</main>
        <Footer collections={footerCollections} />
      </body>
    </html>
  );
}
