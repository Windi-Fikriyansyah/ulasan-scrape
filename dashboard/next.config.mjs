/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  async rewrites() {
    return [
      { source: "/ambil", destination: "/" },
      { source: "/lead", destination: "/" },
      { source: "/sosmed", destination: "/" },
      { source: "/autopost", destination: "/" },
      { source: "/akun", destination: "/" },
      { source: "/extension", destination: "/" },
    ];
  },
};
export default nextConfig;
