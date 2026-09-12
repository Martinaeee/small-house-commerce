import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Small House PH — Smart Furniture for Small Homes",
    template: "%s | Small House PH",
  },
  description:
    "Space-saving furniture for Philippine small homes. Cash on delivery, nationwide delivery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
