import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PRAGNA 1-A',
    short_name: 'Pragna',
    description: 'PRAGNA 1-A is an AI reasoning assistant with live artifacts, tools, intelligent workflows, and multi-model capabilities.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f5ef',
    theme_color: '#f7f5ef',
    icons: [
      { src: '/favicon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/favicon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
