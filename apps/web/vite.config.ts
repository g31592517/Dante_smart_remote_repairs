import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Dante Smart Remote Repairs',
        short_name: 'Dante Repairs',
        description: 'ICT support, remote assistance, repairs and IT products',
        theme_color: '#0b1f3a',
        background_color: '#f6f8fc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is cached for fast start/offline launch; business data always comes from the network.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/media/products/'),
            handler: 'CacheFirst',
            options: { cacheName: 'product-images', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': API_TARGET, '/media': API_TARGET },
  },
  preview: { port: 4173, proxy: { '/api': API_TARGET, '/media': API_TARGET } },
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
});
