/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  transpilePackages: ["@nutrition/nutrition-engine", "@nutrition/contracts"],
  webpack: (config) => {
    // Resolve .js imports to .ts source files for workspace packages (ESM TypeScript convention)
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
