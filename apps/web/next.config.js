/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@product-scout/ui',
    '@product-scout/domain',
    '@product-scout/db',
    '@product-scout/agent-sdk',
    '@product-scout/research',
    '@product-scout/agent',
  ],
};

module.exports = nextConfig;
