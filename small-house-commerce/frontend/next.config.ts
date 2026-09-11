import type { NextConfig } from "next";

const API_TARGET = process.env.API_TARGET ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // Proxy the storefront API to the backend so the browser never hits CORS.
  // All API calls from the frontend use relative /api/v1 paths.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_TARGET}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
