/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  async rewrites() {
    return [
      { source: "/ambil", destination: "/" },
      { source: "/lead", destination: "/" },
      { source: "/autopost", destination: "/" },
      { source: "/akun", destination: "/" },
    ];
  },
};
export default nextConfig;
