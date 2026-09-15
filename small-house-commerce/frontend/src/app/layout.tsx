import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
