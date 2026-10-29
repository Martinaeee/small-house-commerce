import type { NextConfig } from "next";

const API_TARGET = process.env.API_TARGET || "http://localhost:3000";

const nextConfig: NextConfig = {
  // Minimal self-contained server output for the production Docker image
  // (Task 3). `next dev` is unaffected; rewrites below still apply.
  output: "standalone",

  // Uploaded originals are 1–2.6MB PNGs served raw by the backend, and the
  // bundled /about photography is ~2.8MB of JPEGs; only those two trees are
  // eligible for the built-in optimizer (localPatterns gates every other
  // local path), which resizes and re-encodes to WebP on demand. AVIF
  // encoding is too slow on the container CPU — WebP only.
  images: {
    localPatterns: [{ pathname: "/uploads/**", search: "" }, { pathname: "/about/**", search: "" }],
    formats: ["image/webp"],
    // The optimizer rejects any width outside these allowlists; storefront
    // components request 96 (thumbnails), 640 (cards), 1280 (gallery) and
    // 1440 (heroes/content). 96 is already in the default imageSizes.
    deviceSizes: [640, 750, 828, 1080, 1200, 1280, 1440, 1920, 2048],
  },

  // Draft preview routes are operator-only (spec §5.2): never cached by
  // shared caches, and `no-referrer` keeps the token-bearing URL out of
  // outbound Referer headers. Next applies these before rendering and its own
  // dynamic-page Cache-Control respects an already-set value (see
  // server/send-payload.js), so `private, no-store` is what ships.
  async headers() {
    return [
      {
        source: "/admin/marketing/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/preview/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },

  // Proxy the storefront API to the backend so the browser never hits CORS.
  // All API calls from the frontend use relative /api/v1 paths.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_TARGET}/api/v1/:path*`,
      },
      // Local-disk uploaded images are served by the backend (dev convenience:
      // prod Caddy routes /uploads straight to the backend).
      {
        source: "/uploads/:path*",
        destination: `${API_TARGET}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
