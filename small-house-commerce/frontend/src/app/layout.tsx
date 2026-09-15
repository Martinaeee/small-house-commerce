import type { Metadata } from "next";
import "./globals.css";
import { BootSplash } from "@/components/layout/BootSplash";
import { BootSplashAssets } from "@/components/layout/BootSplashAssets";

export const metadata: Metadata = {
  metadataBase: new URL("https://luwag.ph"),
  title: {
    default: "LUWAG Living | Small-Space & Condo Furniture Philippines",
    template: "%s | LUWAG Living",
  },
  description:
    "Small-space furniture, made roomy — for Filipino condos and rentals. Cash on delivery, nationwide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot splash marks <html data-splash-done> pre-hydration.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/*
          Root layout is synchronous, so this markup ships in the very first
          HTML shell — before any async segment (e.g. the storefront layout
          awaiting nav data) resolves. That is what makes the splash visible
          during a slow TTFB rather than arriving with the content itself.
        */}
        <BootSplashAssets />
        <BootSplash />
        {children}
        {/*
          Fires as soon as the visible server-rendered tree has streamed out
          (independent of deferred JS chunks / hydration). The init script
          decides: fast load -> hide instantly, slow load -> hold a branded
          beat then fade. DOMContentLoaded/load only backstop it.
        */}
        <script
          id="boot-splash-finish"
          dangerouslySetInnerHTML={{
            __html: "window.__splashReady&&window.__splashReady();",
          }}
        />
      </body>
    </html>
  );
}
