import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/terminal/:path*',
        destination: 'http://localhost:7681/:path*',
      },
    ];
  },
};

export default nextConfig;
