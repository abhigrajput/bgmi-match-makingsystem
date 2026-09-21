/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Overridable so a verification build (NEXT_DIST_DIR=.next-build) can run
  // while `next dev` is serving from .next -- two processes writing one build
  // directory corrupt each other's output.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
