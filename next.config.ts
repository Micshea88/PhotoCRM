import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // typedRoutes intentionally off until all routes exist; re-enable in a later phase.
  typedRoutes: false,
}

export default nextConfig
