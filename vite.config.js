import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Backend dev server (Spring Boot). Override with VITE_API_BASE / API_PROXY_TARGET.
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8080';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'Growth Buddy',
        short_name: 'Growth Buddy',
        description: 'Your friendly accountability app for habits, tasks, fitness and growth.',
        theme_color: '#F97316',
        background_color: '#F97316',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the built app shell so the app opens offline — lazy chunks
        // included, deliberately.
        //
        // They were excluded once, to save pulling every screen on first visit.
        // What that actually bought was ~27KB gzipped; what it cost was every
        // screen you had not already opened, on every deploy. The service worker
        // serves the previous build's index.html and entry bundle from the
        // precache, that bundle asks for assets/circle-<oldhash>.js, and the new
        // deploy replaced dist/ wholesale — so the chunk 404s, the dynamic import
        // rejects, and lazyScreen() paints the crash card. Six screens dead until
        // the worker happens to update.
        //
        // Precached, the shell and its chunks version together and cannot skew.
        // Code-splitting still earns its keep: it keeps first paint from blocking
        // on screens you may never open.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // Pull our Web Push 'push' / 'notificationclick' handlers into the
        // generated service worker (keeps Workbox precaching intact).
        importScripts: ['/push-handlers.js'],
        runtimeCaching: [
          {
            // Anything hashed that escapes the precache (a chunk added by a
            // dependency, a map). CacheFirst is safe because the filenames are
            // content-hashed — a changed chunk is a different URL, so a stale
            // entry can't be served.
            urlPattern: ({ url, request }) =>
              request.destination === 'script' && /\/assets\/.*\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gb-chunks',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Read-through cache for API GETs: prefer the network, fall back to
            // the last cached response when offline so the UI still renders.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && /\/api\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gb-api-get',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // Keep the service worker out of the way during local development.
      devOptions: { enabled: false },
    }),
  ],
  /* Build number, printed to the console at boot (window.GB_BUILD). BUMP IT BY
     ONE before every push — that is the whole mechanism. A phone logging a
     smaller number than the latest push is running a cached build.
     ponytail: deliberately hand-cranked. Deriving it from the clock or the git
     history needs no discipline but gives you a number nobody can recite; this
     one you can. If it starts drifting because someone forgets, move it to
     `git rev-list --count HEAD` minus an offset. */
  define: { __GB_BUILD__: 4 },
  // index.html at the project root is the entry; it pulls in scripts/app.js as a module.
  root: '.',
  // The repo's assets/ holds dev screenshots we don't want copied verbatim;
  // real static files (icons, manifest, service worker) live in public/.
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 'hidden' still emits the maps (upload them to your error tracker) but drops
    // the //# sourceMappingURL comment, so the published bundle doesn't hand out
    // readable source to anyone who opens devtools.
    sourcemap: 'hidden',
  },
  // `vite preview` serves the production build, and without the same proxy every
  // /api call is cross-origin and dies on CORS — so the prod bundle can't be
  // exercised locally at all. Same target and Origin rewrite as `server`.
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', API_TARGET));
        },
      },
      '/ws': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', API_TARGET));
          proxy.on('proxyReqWs', (proxyReq) => proxyReq.setHeader('origin', API_TARGET));
        },
      },
    },
  },
  server: {
    port: 5173,
    // In dev, talk to the backend through a same-origin proxy so the app can use
    // relative API paths (and so an httpOnly auth cookie works without CORS pain).
    // The proxy also rewrites the Origin header to the backend's own origin so
    // the request reads as same-origin and passes the backend's CORS check
    // (the Vite dev origin :5173 isn't in the backend's allow-list).
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('origin', API_TARGET);
          });
        },
      },
      '/ws': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          // SockJS uses both XHR (proxyReq) and a WebSocket upgrade (proxyReqWs).
          // Rewrite Origin on both so the backend's CORS check passes.
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', API_TARGET));
          proxy.on('proxyReqWs', (proxyReq) => proxyReq.setHeader('origin', API_TARGET));
        },
      },
    },
  },
});
