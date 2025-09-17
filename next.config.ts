import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Не останавливать билд из-за ESLint ошибок
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Не останавливать билд из-за TS ошибок
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
