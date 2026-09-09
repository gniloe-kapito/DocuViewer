import type { NextConfig } from "next";

/**
 * Static export support for GitHub Pages.
 *
 * The dev server (no env) uses `output: 'standalone'` so the preview
 * environment keeps working. When `STATIC_EXPORT=1` is set (used by the
 * GitHub Actions deploy workflow), the build switches to a fully static
 * export with a configurable basePath/assetPrefix derived from the
 * repository name so it works under https://<user>.github.io/<repo>/.
 */
const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : "standalone",
  // PDF.js and image rendering happen client-side; no optimization needed.
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  ...(isStaticExport && basePath
    ? { basePath, assetPrefix: basePath }
    : {}),
  // Prevent trailing-slash redirect issues on GitHub Pages subpaths.
  trailingSlash: true,
};

export default nextConfig;
