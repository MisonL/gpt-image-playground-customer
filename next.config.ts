import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": ["./generated-images/**/*", "./artifacts/**/*", "./dist/**/*", "./.next/cache/**/*"],
  },
};

export default nextConfig;
