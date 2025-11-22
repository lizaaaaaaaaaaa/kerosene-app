// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // SW は自動更新（main.tsx 側で virtual:pwa-register を呼んでいればOK）
      registerType: 'autoUpdate',
      devOptions: { enabled: false }, // 開発中はSW無効（必要なら true に）
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: '灯油配達システム',
        short_name: '灯油配達',
        description: '灯油配達の受付・計画・履歴を、オフラインでも快適に利用できます。',
        start_url: '.',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2d89ef',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // ビルド成果物の静的キャッシュ
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // ランタイムキャッシュ（外部CDNやAPI）
        runtimeCaching: [
          // OpenStreetMap タイルのキャッシュ（Todayの地図で使う）
          {
            urlPattern: ({ url }) =>
              url.origin.includes('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 14, // 14日
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 画像のキャッシュ
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'images' },
          },
          // JS/CSSのキャッシュ（更新に強い）
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' || request.destination === 'style',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'assets' },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'), // '@/...' インポート用
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
