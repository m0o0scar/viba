/** @type {import("next").NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/terminal/:path*",
        destination: "http://127.0.0.1:7681/:path*",
      },
    ];
  },
};

export default nextConfig;
