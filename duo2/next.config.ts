import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Self-contained server bundle for the container image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Pin the project root (there is an unrelated package-lock.json in the home folder).
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
