import type { NextConfig } from "next";

/**
 * DocuViewer — build configuration.
 *
 * - `next dev` / `next build` without env vars — standard Next.js behaviour.
 * - `STATIC_EXPORT=1` (used by `bun run build` / `build:static` and by the
 *   GitHub Actions deploy workflow) — fully static export into `out/`,
 *   suitable for GitHub Pages / any static hosting.
 * - `NEXT_PUBLIC_BASE_PATH=/<repo-name>` — set it when the site is served
 *   from a subpath, e.g. https://<user>.github.io/<repo-name>/.
 *   The deploy workflow computes it automatically from the repo name.
 */
const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isStaticExport ? { output: "export" as const } : {}),
  // All document rendering (pdf.js, docx-preview, images) happens
  // client-side; the Next.js image optimizer is not needed.
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Avoid trailing-slash redirect issues on GitHub Pages subpaths.
  trailingSlash: true,
  ...(isStaticExport && basePath
    ? { basePath, assetPrefix: basePath }
    : {}),
};

export default nextConfig;
