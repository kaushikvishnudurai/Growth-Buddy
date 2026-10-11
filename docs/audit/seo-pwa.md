# SEO and PWA audit

Branch `feat/overhaul`, build 88. Checked against `npm run build` output (`dist/sw.js`,
`dist/manifest.webmanifest`, `dist/index.html`) and the backend's serving code
(`IndexController`, `WebConfig.addResourceHandlers`, `SecurityHeadersFilter`).

Summary: 3 High, 4 Medium, 11 Low.

| ID | Title | Severity | Effort |
|---|---|---|---|
| SP-01 | New deploys never reach an open or installed app; no update prompt | High | M |
| SP-02 | `/privacy.html` returns 404 in production | High | S |
| SP-03 | Session expiry leaves the old account's API cache for the next account | High | S |
| SP-04 | Full data export is persisted in Cache Storage | Medium | S |
| SP-05 | NetworkFirst 5 s timeout serves stale data on slow networks | Medium | S |
| SP-06 | No Open Graph / Twitter card: shared invite links preview bare | Medium | S |
| SP-07 | Manifest locks the installed app to portrait | Medium | S |
| SP-08 | No robots.txt or sitemap | Low | S |
| SP-09 | No canonical URL; `/` and `/index.html` both serve the shell | Low | S |
| SP-10 | Sign-in page has no content without JavaScript | Low | S |
| SP-11 | Privacy policy is not linked from the web app | Low | S |
| SP-12 | Manifest lacks `id`, `screenshots`, `shortcuts`, `categories` | Low | M |
| SP-13 | No iOS launch splash | Low | M |
| SP-14 | Push `badge` is the full-colour app icon | Low | S |
| SP-15 | Only an SVG favicon is linked; `/favicon.ico` 404s | Low | S |
| SP-16 | `gb-api-get` is not versioned across deploys | Low | S |
| SP-17 | `privacy.html` has no description, canonical or icon | Low | S |

---

### SP-01 New deploys never reach an open or installed app; no update prompt
- **Severity** High - **Effort** M
- **Where** `vite.config.js` `VitePWA({ registerType: 'autoUpdate', injectRegister: false })`;
  `scripts/app.js` top-level `navigator.serviceWorker.register('/sw.js')`; generated `dist/sw.js`.
- **Verified** `dist/sw.js` calls `self.skipWaiting()` only inside a `message` listener for
  `{type:'SKIP_WAITING'}` and never calls `clientsClaim()`. Nothing in `scripts/` posts that message
  or listens for `updatefound` / `controllerchange` (grep: zero hits). `autoUpdate` only takes effect
  through the plugin's `registerSW` helper, which `injectRegister: false` plus a hand-rolled
  `register()` bypasses.
- **Consequence** The new worker installs and sits in `waiting` until every tab and the installed PWA
  are fully closed. The old worker keeps serving the old precached `index.html` and bundle, so
  `IndexController`'s `no-store` is irrelevant. An installed PWA on iOS/Android is rarely terminated,
  so users run old builds (and old bug fixes) for days; there is no "update available" signal. The
  worker is also only re-checked on navigation, which a hash-routed SPA does not do.
- **Fix** Use `import { registerSW } from 'virtual:pwa-register'` (registerType `'prompt'`) in the
  web branch: on `onNeedRefresh` show a toast "Update ready - Reload" that calls `updateSW(true)`;
  in `onRegisteredSW` call `r.update()` on `visibilitychange` to visible. Do not switch to blind
  `skipWaiting`+`clientsClaim`: that deletes the old precache under a running page and reintroduces
  the chunk-404 skew the workbox comment describes.

### SP-02 `/privacy.html` returns 404 in production
- **Severity** High - **Effort** S
- **Where** `WebConfig.addResourceHandlers` (root-level patterns `/*.js, /*.css, /*.png, /*.svg,
  /*.ico, /*.webmanifest, /*.woff2, /*.json, /*.txt`); `IndexController.index` (maps only `/` and
  `/index.html`).
- **Verified** `privacy.html` is in `dist/` but no handler matches `*.html` other than
  `index.html`; `dist/` is on the filesystem, not the classpath, so Spring's default static handler
  cannot find it either.
- **Consequence** Any first-time visitor, crawler, Play Store / App Store reviewer or Health Connect
  rationale link that opens the hosted privacy URL gets a 404. Only browsers that already have the
  service worker see it (it is precached). Store listings require a reachable privacy policy URL.
- **Fix** Add `"/*.html"` to the root `addResourceHandler(...)` list (no-cache is fine), or add
  `"/privacy.html"` to `IndexController`-style single-file mapping.

### SP-03 Session expiry leaves the old account's API cache for the next account
- **Severity** High - **Effort** S
- **Where** `scripts/app.js` `handleAuthExpired()`; `vite.config.js` runtimeCaching `gb-api-get`.
- **Verified** `logout()` and the delete-account flow call `caches.delete('gb-api-get')`;
  `handleAuthExpired()` (every 401 from `api()` and the streaming path) clears state but not the
  cache. Workbox keys entries by URL only and ignores the `Authorization` header.
- **Consequence** Session revoked / expired / signed out elsewhere -> app bounces to sign-in with
  up to 200 of the previous account's responses (tasks, money, notes, notifications) still cached
  for 24 h. The next person who signs in on that browser and is offline, or whose request takes
  longer than 5 s (SP-05), is served the previous account's data under their own session.
- **Fix** Move the `caches.delete('gb-api-get')` into `clearSession()` (or call it from
  `handleAuthExpired()`), so every exit path clears it. Optionally key the cache per user
  (`cacheName: 'gb-api-get'` plus a `cacheKeyWillBeUsed` plugin that appends the user id).

### SP-04 Full data export is persisted in Cache Storage
- **Severity** Medium - **Effort** S
- **Where** `vite.config.js` runtimeCaching `urlPattern` for `/api/`; `scripts/app.js`
  "Download my data" (`api('/api/auth/export')`) and `api('/api/reminders/export.ics')`.
- **Verified** Both are GETs under `/api/` with status 200, so the NetworkFirst route stores them.
- **Consequence** A complete dump of every table the account owns sits unencrypted in
  `gb-api-get` for up to 24 h (and indefinitely past a session expiry, SP-03), readable by anyone
  with the device profile. It also costs the cache a large entry for a one-off download.
- **Fix** Exclude non-offline endpoints in the `urlPattern`, e.g.
  `&& !/\/api\/(auth\/export|reminders\/export\.ics|auth\/)/.test(url.pathname)`, or set the
  export responses to `Cache-Control: no-store` and add a `cacheWillUpdate` plugin that honours it.

### SP-05 NetworkFirst 5 s timeout serves stale data on slow networks
- **Severity** Medium - **Effort** S
- **Where** `vite.config.js` runtimeCaching `gb-api-get` `networkTimeoutSeconds: 5`.
- **Verified** With a timeout, Workbox answers from cache when the network is merely slow, not only
  when it fails; the app cannot tell the difference (no header is added).
- **Consequence** On a 3G-class connection, a refresh after a write (task toggled, expense added)
  can resolve with the pre-write response and repaint the old state, which reads as a lost save.
  Combined with SP-03 it is also the path to cross-account data without being offline.
- **Fix** Drop `networkTimeoutSeconds` so the cache is used only when the fetch rejects (offline).

### SP-06 No Open Graph / Twitter card: shared invite links preview bare
- **Severity** Medium - **Effort** S
- **Where** `index.html` `<head>`; invite URLs from `circle-core.js` `inviteLink()` are
  `<origin>/#/circle?join=CODE`, so every preview bot fetches `/`.
- **Verified** No `og:*` or `twitter:*` tags in `index.html` or `dist/index.html`.
- **Consequence** A Circle invite pasted into WhatsApp, iMessage, Slack or LinkedIn shows a bare URL
  or just "Growth Buddy" with no image or description, which lowers invite acceptance.
- **Fix** Add `og:type=website`, `og:site_name`, `og:title`, `og:description`, `og:url`,
  `og:image` (absolute URL, 1200x630 PNG in `public/`), `twitter:card=summary_large_image`.
  The hash keeps the join code out of the fetched URL, which is correct; keep it that way.

### SP-07 Manifest locks the installed app to portrait
- **Severity** Medium - **Effort** S
- **Where** `vite.config.js` `manifest.orientation: 'portrait'`.
- **Verified** `styles/app.css` has a dedicated `@media (orientation: landscape) and
  (max-height: 500px)` icon-rail layout, and the app supports a >=1024px sidebar layout.
- **Consequence** Installed on Android or ChromeOS, the PWA is locked to portrait, so the landscape
  rail is unreachable and tablets cannot rotate. The browser tab and Capacitor app rotate, the
  installed web app does not.
- **Fix** Remove `orientation` (or set `'any'`).

### SP-08 No robots.txt or sitemap
- **Severity** Low - **Effort** S
- **Where** `public/` (absent); `WebConfig` already routes `/*.txt` to `dist/`.
- **Consequence** `/robots.txt` 404s; crawlers have no `Disallow` for `/api/` (JSON endpoints such as
  health checks can be crawled) and no sitemap pointing at the two pages that should be indexed.
- **Fix** `public/robots.txt`: `User-agent: *`, `Disallow: /api/`, `Disallow: /ws/`,
  `Sitemap: https://<host>/sitemap.xml`. `public/sitemap.xml` with `/` and `/privacy.html` (needs
  `/*.xml` in the `WebConfig` root patterns). Everything behind login is hash-routed and not
  crawlable anyway, so no further noindex is needed.

### SP-09 No canonical URL; `/` and `/index.html` both serve the shell
- **Severity** Low - **Effort** S
- **Where** `index.html`; `IndexController.index` maps both paths.
- **Consequence** Two indexable URLs for the same page split signals; the Render host and any custom
  domain also both serve it.
- **Fix** `<link rel="canonical" href="https://<host>/">` in `index.html`.

### SP-10 Sign-in page has no content without JavaScript
- **Severity** Low - **Effort** S
- **Where** `index.html` `<div id="root"></div>`.
- **Consequence** Non-rendering crawlers and preview bots see only the title and description; the
  landing page has no heading or copy to rank on, and users with JS blocked see a blank page.
- **Fix** Put a short static `<h1>` + one-paragraph pitch + privacy link inside `#root` (the app
  replaces it on mount), and a `<noscript>` line.

### SP-11 Privacy policy is not linked from the web app
- **Severity** Low - **Effort** S
- **Where** `scripts/` (grep `privacy`: no hits); auth views in `app.js`.
- **Consequence** Users signing up on the web never see the policy, and crawlers cannot discover
  `privacy.html` from `/`.
- **Fix** A "Privacy" link under the sign-in / sign-up card and in Settings -> About.

### SP-12 Manifest lacks `id`, `screenshots`, `shortcuts`, `categories`
- **Severity** Low - **Effort** M
- **Where** `vite.config.js` `manifest`.
- **Consequence** No `id` means the app identity is derived from `start_url`; changing `start_url`
  later creates a second install. No `screenshots` means Chrome shows the minimal install prompt
  instead of the richer install dialog. No `shortcuts` (long-press: Add task, Log expense, Start
  focus) and no `categories` for store-style listings.
- **Fix** Add `id: '/'`, `categories: ['productivity','health','lifestyle']`, two screenshots
  (one `form_factor: 'narrow'`, one `'wide'`) and 3 `shortcuts` to hash routes.

### SP-13 No iOS launch splash
- **Severity** Low - **Effort** M
- **Where** `index.html` (no `apple-touch-startup-image`).
- **Consequence** iOS ignores the manifest's `background_color` and shows a white screen while the
  home-screen app boots. `apple-touch-icon` (180x180) and status-bar meta are present and correct.
- **Fix** Generate the per-device `apple-touch-startup-image` set (e.g. `pwa-asset-generator`) or
  accept the white flash knowingly.

### SP-14 Push `badge` is the full-colour app icon
- **Severity** Low - **Effort** S
- **Where** `public/push-handlers.js` `badge: '/icons/icon-192.png'` (both `showNotification` calls).
- **Consequence** Android renders the badge as an alpha mask: the opaque rounded square becomes a
  solid white blob in the status bar instead of the seedling.
- **Fix** Ship a 96x96 monochrome transparent `icons/badge-96.png` (seedling only) and point `badge`
  at it.

### SP-15 Only an SVG favicon is linked; `/favicon.ico` 404s
- **Severity** Low - **Effort** S
- **Where** `index.html` `<link rel="icon" type="image/svg+xml">`; `public/favicon-32.png` shipped
  and precached but never linked; `WebConfig` maps `/*.ico` but no file exists.
- **Consequence** Browsers and tools without SVG favicon support fall back to `/favicon.ico` and get
  a 404 on every visit.
- **Fix** Add `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">` after the
  SVG link, and a `public/favicon.ico`.

### SP-16 `gb-api-get` is not versioned across deploys
- **Severity** Low - **Effort** S
- **Where** `vite.config.js` runtimeCaching `cacheName: 'gb-api-get'`.
- **Consequence** `cleanupOutdatedCaches` only cleans the precache; after a deploy that changes a
  response shape, the new client offline reads JSON written by the old server.
- **Fix** Accept it (24 h expiry bounds it) or name it `'gb-api-get-' + buildNumber()` and change the
  three `caches.delete('gb-api-get')` calls to delete by prefix.

### SP-17 `privacy.html` has no description, canonical or icon
- **Severity** Low - **Effort** S
- **Where** `public/privacy.html` `<head>`.
- **Consequence** Search results show an auto-extracted snippet and a generic icon for the one
  indexable content page.
- **Fix** Add `<meta name="description">`, `<link rel="canonical">`, `<link rel="icon"
  href="/logomark.svg">`.

---

Checked and fine: `sw.js` and `manifest.webmanifest` are served `no-cache` (WebConfig root
handler), hashed `/assets/**` immutable; offline navigation falls back to the precached
`/index.html`; precache is revisioned with `cleanupOutdatedCaches()`; lazy chunks are precached
(no version skew); `logout()` and account deletion clear `gb-api-get`; the native shell
unregisters any worker; invite join codes live in the URL hash so preview bots never receive them;
`apple-touch-icon` is 180x180; maskable icons are declared separately from `any`.
