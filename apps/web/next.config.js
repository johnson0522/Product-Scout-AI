/** @type {import('next').NextConfig} */
const nextConfig = {
  // The pinned SDK resolves its child runtime relative to import.meta.url.
  // Preserve that ESM package boundary instead of bundling it into a route.
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push(({ context, request }, callback) => {
        if (request !== '@deepseek-ai/dsh-sdk-client') return callback();
        // pnpm keeps the SDK under apps/agent. Next's default external check
        // requires a web-level dependency, so resolve from the actual importer.
        const entry = require.resolve(request, { paths: [context] });
        import('node:url').then(({ pathToFileURL }) => {
          callback(null, `import ${pathToFileURL(entry).href}`);
        }, callback);
      });
    }
    return config;
  },
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
