/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Media can be large; allow bigger request bodies to server actions/route handlers.
  experimental: {
    serverActions: {
      bodySizeLimit: "512mb",
    },
  },
  // We store uploads on disk and never optimize remote images.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
