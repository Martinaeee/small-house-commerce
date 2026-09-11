import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MetaPixelInit } from "@/components/tracking/MetaPixelInit";
import { serverApiUrl, type Collection } from "@/lib/api";

export const metadata: Metadata = {
  title: {
    default: "Small House PH — Smart Furniture for Small Homes",
    template: "%s | Small House PH",
  },
  description:
    "Space-saving furniture for Philippine small homes. Cash on delivery, nationwide delivery.",
};

async function getCollections(): Promise<Collection[]> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/collections?type=NAVIGATION"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items: Collection[] };
    return body.items;
  } catch {
    // Navigation is enhancement; a backend outage must not blank the site.
    return [];
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const collections = await getCollections();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <MetaPixelInit />
        <Header collections={collections} />
        <main className="flex-1">{children}</main>
        <Footer collections={collections} />
      </body>
    </html>
  );
}
