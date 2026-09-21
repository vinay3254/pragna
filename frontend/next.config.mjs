import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false,
  distDir: process.env.DIST_DIR || '.next',
  // The dev-mode indicator's hit-region sits over this app's own top-right
  // header controls (Share, etc.) and silently swallows clicks meant for
  // them — repositioning the visible badge alone didn't move the hit-region.
  // Disable it entirely rather than lose clicks on real UI in dev mode.
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
    qualities: [75, 85, 100],
  },
  webpack(
    config,
    {
      dev: dev
    }
  ) {
    if (dev) {
      if (process.env.ENABLE_COMPONENT_TAGGER === 'true') {
        config.module.rules.push({
          test: /\.(jsx|tsx)$/,
          exclude: [/node_modules/],
          use: [{
            loader: '@dhiwise/component-tagger/nextLoader',
          }],
        });
      }
      const ignoredPaths = (process.env.WATCH_IGNORED_PATHS || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      config.watchOptions = {
        ignored: ignoredPaths.length
          ? ignoredPaths.map((p) => `**/${p.replace(/^\/+|\/+$/g, '')}/**`)
          : undefined,
      };
    }
    return config;
  },
  async rewrites() {
    const backendUrl =
      process.env.NEXT_PUBLIC_API_BASE ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      'https://pragna-p7ij.onrender.com';

    return [
      {
        source: '/api/conversations/:path*',
        destination: `${backendUrl}/api/conversations/:path*`,
      },
      {
        source: '/api/documents/:path*',
        destination: `${backendUrl}/api/documents/:path*`,
      },
      {
        source: '/api/memories/:path*',
        destination: `${backendUrl}/api/memories/:path*`,
      },
      {
        source: '/api/voice/:path*',
        destination: `${backendUrl}/api/voice/:path*`,
      },
      {
        source: '/api/artifacts/:path*',
        destination: `${backendUrl}/api/artifacts/:path*`,
      },
      {
        source: '/api/tools/:path*',
        destination: `${backendUrl}/api/tools/:path*`,
      },
      {
        source: '/api/scheduled-tasks/:path*',
        destination: `${backendUrl}/api/scheduled-tasks/:path*`,
      },
      {
        source: '/api/system/:path*',
        destination: `${backendUrl}/api/system/:path*`,
      },
      {
        source: '/api/agent/:path*',
        destination: `${backendUrl}/api/agent/:path*`,
      },
      {
        source: '/api/messages/:path*',
        destination: `${backendUrl}/api/messages/:path*`,
      },
      {
        source: '/api/auth/:path*',
        destination: `${backendUrl}/api/auth/:path*`,
      },
      {
        source: '/api/chat/:path+',
        destination: `${backendUrl}/api/chat/:path*`,
      },
      {
        source: '/api/share/:path*',
        destination: `${backendUrl}/api/share/:path*`,
      },
    ];
  },
};
export default nextConfig;