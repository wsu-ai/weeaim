import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// In production (Vercel) the browser calls the API on the site's own address
// and Vercel forwards /api/* to the backend (BACKEND_URL, e.g. on Render).
// Keeping one address lets the Secure, same-site session cookie work.
// Locally BACKEND_URL is unset and the app calls NEXT_PUBLIC_API_URL directly.
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!backendUrl) return [];
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
