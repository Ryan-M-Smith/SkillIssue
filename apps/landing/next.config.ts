import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Homepage preview: show public/home-preview.html at "/" instead of src/app/page.tsx.
  // To go back to the original homepage, delete this rewrites() block (page.tsx is untouched).
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/home-preview.html" }],
    };
  },
};

export default nextConfig;
