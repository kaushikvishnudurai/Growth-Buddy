import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Backend dev server (Spring Boot). Override with VITE_API_BASE / API_PROXY_TARGET.
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8080';

/* Build number, printed to the console at boot (window.GB_BUILD). BUMP IT BY
   ONE before every push — that is the whole mechanism. A phone logging a
   smaller number than the latest push is running a cached build.

   Hand-cranked on purpose, and it stays that way. It was briefly derived from
   `git rev-list --count HEAD`, which is right on a laptop and wrong in the only
   place it matters: .dockerignore excludes .git, the web stage of
   backend/Dockerfile copies four paths and none of them is a repo, and
   node:22-slim has no git binary — so every production image reported build 0.
   A literal is readable by any build anywhere, which is the whole requirement.

   GB_BUILD=<n> in the environment overrides it for a one-off build. */
const BUILD = 109;
const buildNumber = () => Number(process.env.GB_BUILD) || BUILD;

/* The public site, for what has to be an absolute URL: canonical, og:url,
   og:image, the sitemap. The same host the mobile build points VITE_API_BASE at
   (Growth-Buddy-Mobile package.json) and keep-awake.yml pings — the backend
   serves the SPA, so it is the site. GB_SITE_URL overrides for another deploy.
   The app itself never reads this: in a browser the site is location.origin, in
   the phone app it is the API base (native.js publicSiteUrl). */
const SITE_URL = (process.env.GB_SITE_URL || 'https://growth-buddy-cu63.onrender.com').replace(
  /\/+$/,
  ''
);

/* %GB_SITE_URL% in index.html and public/privacy.html becomes SITE_URL, and
   robots.txt + sitemap.xml are written here rather than kept in public/, so the
   host lives in one place. public/ is copied verbatim, hence the rewrite after
   the write. (On the dev server privacy.html keeps the placeholder; only a
   build is ever crawled.) */
function siteFiles() {
  let outDir = 'dist';
  return {
    name: 'gb-site-files',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml: (html) => html.replaceAll('%GB_SITE_URL%', SITE_URL),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source:
          'User-agent: *\nAllow: /\nAllow: /privacy.html\nDisallow: /api/\nDisallow: /ws/\n\n' +
          'Sitemap: ' + SITE_URL + '/sitemap.xml\n',
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          ['/', '/privacy.html'].map((p) => '  <url><loc>' + SITE_URL + p + '</loc></url>\n').join('') +
          '</urlset>\n',
      });
    },
    writeBundle() {
      const file = join(outDir, 'privacy.html');
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('%GB_SITE_URL%', SITE_URL));
    },
  };
}

/* Home's first render waits for the Outlook chunk (dashboard.js loadOutlook, with
   wave 1), so the browser should fetch it beside the boot chunk instead of after
   it: requested from app code, it raced Home's fonts and held the first Home
   render ~0.8 s on a throttled phone. Vite only preloads static imports. */
const preloadOutlook = {
  name: 'gb-preload-outlook',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, { bundle }) {
      const chunk = Object.values(bundle || {}).find(
        (c) => c.type === 'chunk' && Object.keys(c.modules).some((id) => id.endsWith('/scripts/outlook.js'))
      );
      if (!chunk) return html;
      return [{ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/' + chunk.fileName }, injectTo: 'head' }];
    },
  },
};

export default defineConfig({
  plugins: [
    siteFiles(),
    preloadOutlook,
    VitePWA({
      // A new build waits until the user says Reload (app.js registerSW →
      // "A new version is ready"). Never skipWaiting + clientsClaim on its own:
      // that swaps the precache under a running page — see the workbox comment.
      registerType: 'prompt',
      // Registered by app.js (virtual:pwa-register), which skips it in the
      // Capacitor app.
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png', 'favicon-32.png'],
      // See globIgnores: the manifest's install icons are not precached.
      includeManifestIcons: false,
      manifest: {
        // Identity of the install. Without it Chrome derives one from start_url,
        // so a start_url change would make a second app.
        id: '/',
        name: 'Growth Buddy',
        short_name: 'Growth Buddy',
        description: 'Your friendly accountability app for habits, tasks, fitness and growth.',
        theme_color: '#F97316',
        background_color: '#F97316',
        display: 'standalone',
        // The app has a landscape rail and a desktop sidebar; don't lock it.
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'health', 'lifestyle'],
        // Long-press on the icon. app.js routes ?shortcut= after the first data
        // load (launch-intent.js), then strips it from the address.
        shortcuts: [
          { name: 'Log water', short_name: 'Water', description: 'Log a 250 ml glass', url: '/?shortcut=water', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Add task', short_name: 'Task', description: 'Add a task for today', url: '/?shortcut=task', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Start focus', short_name: 'Focus', description: 'Start a focus session', url: '/?shortcut=focus', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Quick add', short_name: 'Quick add', description: 'Log anything in one line', url: '/?shortcut=quickadd', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
        // "Share to Growth Buddy" from another app: the text lands in Quick add's
        // preview, and nothing is written until the user confirms there.
        share_target: {
          action: '/',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        // The richer install dialog. Real screens from a seeded test account.
        screenshots: [
          { src: 'screenshots/home-narrow.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'Home: today at a glance' },
          { src: 'screenshots/home-wide.jpg', sizes: '1280x800', type: 'image/jpeg', form_factor: 'wide', label: 'Home on a larger screen' },
        ],
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
        // Not shell, so not precached. Install-time icons: the OS fetches them
        // once when the app is added to a home screen, and no screen draws them
        // (~39 kB; icon-192 stays: notifications and the share card use it).
        // privacy.html: a standalone page for the store listing, linked from
        // nowhere in the app (~8 kB); the denylist keeps an offline visit to it
        // from being answered with the app shell. Nor the link-preview image,
        // the iOS launch images (iOS reads them at install) or the install
        // dialog's screenshots.
        globIgnores: [
          'icons/icon-512.png',
          'icons/maskable-*.png',
          'privacy.html',
          'og-image.png',
          'splash/**',
          'screenshots/**',
        ],
        navigateFallbackDenylist: [/^\/privacy\.html$/],
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
            // No networkTimeoutSeconds: with one, a merely slow answer was
            // replaced by the cached one, so a refresh after a write repainted
            // the pre-write state. The cache answers only when the fetch fails.
            // Keyed by URL only, so every sign-out deletes it (app.js endSession).
            // Not /api/auth/*: a cached /me is older than the session this device
            // keeps (saveUiPrefs mirrors into it), and wave 2 put its prefs back
            // over it; and the full data export is every row the account owns,
            // it must not sit in Cache Storage afterwards. Not the .ics
            // download either. Not /api/notes*: Notes keeps its own offline copy
            // (read-only, with its banner); answered from here it read as online
            // and offered edits that could not save.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /\/api\//.test(url.pathname) &&
              !/\/api\/(auth\/|notes|reminders\/export\.ics$)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gb-api-get',
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
  define: { __GB_BUILD__: buildNumber() },
  // The package's "browser" export is its UMD bundle; the ES build tree-shakes
  // to what connectWebSocket uses (~1 kB smaller in the precache).
  resolve: {
    alias: {
      '@stomp/stompjs': fileURLToPath(new URL('./node_modules/@stomp/stompjs/esm6/index.js', import.meta.url)),
    },
  },
  // index.html at the project root is the entry; it pulls in scripts/app.js as a module.
  root: '.',
  // The repo's assets/ holds dev screenshots we don't want copied verbatim;
  // real static files (icons, manifest, service worker) live in public/.
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No maps by default. 'hidden' only dropped the //# sourceMappingURL comment:
    // the .map files were still written to dist/, copied into the prod image and
    // served by WebConfig's /assets/** handler to anyone who guessed
    // <chunk>.js.map — the full readable source, comments and all. Nothing
    // consumes them (crash reports are log-only, scripts/error-report.js), so
    // there is nothing to upload them to either. GB_SOURCEMAP=1 brings 'hidden'
    // back for a local build you want to debug or feed to a tracker.
    sourcemap: process.env.GB_SOURCEMAP === '1' ? 'hidden' : false,
    // terser, not esbuild's minifier: ~5% smaller JS (boot chunk -28 kB, precache
    // -31 kB at build 95) for a slower build. Nothing unsafe is switched on.
    minify: 'terser',
    terserOptions: { compress: { passes: 2 } },
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
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            proxyReq.setHeader('origin', API_TARGET);
            // A tab closed mid-handshake leaves this socket to EPIPE / ECONNRESET;
            // unhandled, that error took the whole dev server down.
            socket.on('error', () => {});
          });
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
          // The STOMP WebSocket upgrade (proxyReqWs) and any plain request (proxyReq).
          // Rewrite Origin on both so the backend's CORS check passes.
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', API_TARGET));
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            proxyReq.setHeader('origin', API_TARGET);
            // A tab closed mid-handshake leaves this socket to EPIPE / ECONNRESET;
            // unhandled, that error took the whole dev server down.
            socket.on('error', () => {});
          });
        },
      },
    },
  },
});
