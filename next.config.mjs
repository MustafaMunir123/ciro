/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Fix Turbopack TLS issues when fetching Google fonts.
    turbopackUseSystemTlsCerts: true,
  },
};

export default nextConfig;
