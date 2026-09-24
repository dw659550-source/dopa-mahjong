/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dopa/shared"],
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
