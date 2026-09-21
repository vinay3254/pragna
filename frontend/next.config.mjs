import { imageHosts } from './image-hosts.config.mjs';

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');

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
    return [
      {
        source: '/api/conversations/:path*',
        destination: `${BACKEND_URL}/api/conversations/:path*`,
      },
      {
        source: '/api/documents/:path*',
        destination: `${BACKEND_URL}/api/documents/:path*`,
      },
      {
        source: '/api/memories/:path*',
        destination: `${BACKEND_URL}/api/memories/:path*`,
      },
      {
        source: '/api/voice/:path*',
        destination: `${BACKEND_URL}/api/voice/:path*`,
      },
      {
        source: '/api/artifacts/:path*',
        destination: `${BACKEND_URL}/api/artifacts/:path*`,
      },
      {
        source: '/api/tools/:path*',
        destination: `${BACKEND_URL}/api/tools/:path*`,
      },
      {
        source: '/api/scheduled-tasks/:path*',
        destination: 'http://localhost:8000/api/scheduled-tasks/:path*',
      },
      {
        source: '/api/system/:path*',
        destination: `${BACKEND_URL}/api/system/:path*`,
      },
      {
        source: '/api/agent/:path*',
        destination: `${BACKEND_URL}/api/agent/:path*`,
      },
      {
        source: '/api/messages/:path*',
        destination: `${BACKEND_URL}/api/messages/:path*`,
      },
      {
        source: '/api/auth/:path*',
        destination: `${BACKEND_URL}/api/auth/:path*`,
      },
      {
        source: '/api/chat/:path+',
        destination: `${BACKEND_URL}/api/chat/:path*`,
      },
      {
        source: '/api/share/:path*',
        destination: `${BACKEND_URL}/api/share/:path*`,
      },
    ];
  },
};
export default nextConfig;