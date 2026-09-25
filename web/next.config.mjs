/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@dopa/shared"],
  // 牌画像は変わらないので、ブラウザに長期間保存させる（差し替え時は Tile.tsx の TILE_IMAGE_VERSION を上げる）
  async headers() {
    return [
      {
        source: "/tiles/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
