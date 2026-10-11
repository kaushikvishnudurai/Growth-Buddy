# Lighthouse scores, performance round (ov1011/perf)

Lighthouse 13 (node API) in an isolated browser context of a dedicated headless Chrome 154,
production build served by `vite preview` (proxy to the :8590 backend), prefers-color-scheme light.
Signed in = `gb.token` + `gb.session` cookies of a seeded account (`/api/auth/me` user),
`disableStorageReset`. Default throttling = simulated (Lantern); the last table re-runs mobile with
DevTools (applied) throttling. Runs on this shared machine vary by +/- 2-3 points.

Columns: Performance / Accessibility / Best Practices / SEO, then FCP, LCP, TBT, CLS, Speed Index.

## Before: overhaul/2026-10-11 at aec0f46 (build 96), same Chrome, same method

| Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| Signed out, mobile | 92 | 98 | 100 | 91 | 2.7 s | 2.7 s | 0 ms | 0 | 2.7 s |
| Signed out, desktop | 100 | 98 | 100 | 91 | 0.6 s | 0.6 s | 0 ms | 0.004 | 0.6 s |
| Home, mobile | 80 | 98 | 81 | 91 | 3.0 s | 4.2 s | 0 ms | 0 | 3.0 s |
| Home, desktop | 99 | 98 | 81 | 91 | 0.6 s | 0.9 s | 0 ms | 0 | 0.6 s |

Failing then: landmark-one-main (signed out), heading-order and label-content-name-mismatch (Home),
deprecations "Unload event listeners" + bf-cache "unload handler in the main frame" (sockjs-client,
Home), robots-txt (preview answered index.html), render-blocking `/global-shim.js`.

## After: ov1011/perf at fd5de47

| Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| Signed out, mobile | 92-93 | 100 | 100 | 100 | 2.4 s | 2.7-2.9 s | 0 ms | 0 | 2.4 s |
| Signed out, desktop | 100 | 100 | 100 | 100 | 0.5 s | 0.6 s | 0 ms | 0 | 0.5 s |
| Home, mobile | 81-83 | 100 | 100 | 100 | 2.7 s | 4.1-4.2 s | 0 ms | 0 | 2.7 s |
| Home, desktop | 99 | 100 | 100 | 100 | 0.6 s | 0.9 s | 0 ms | 0 | 0.6 s |

Still failing (perf diagnostics only): unused-css-rules, unused-javascript, render-blocking-insight,
network-dependency-tree-insight; label-content-name-mismatch on Home's goal row (weight 0, not mine).

## After, mobile with DevTools throttling

| Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| Signed out, mobile | 95-97 | 100 | 100 | 100 | 2.0-2.1 s | 2.1-2.6 s | 0 ms | 0.01 | 2.2 s |
| Home, mobile | 87-88 | 100 | 100 | 100 | 2.6-2.7 s | 3.2-3.4 s | 20-40 ms | 0.008 | 3.2-3.6 s |

## Why Home mobile is still under 90

Under mobile throttling Home's LCP (the Quick add hint) is: boot chunk (161 kB gzip) + CSS (55 kB)
+ two preloaded fonts sharing one slow link (~2.0 s), then one wave-1 API round trip, then the render.
Main thread work is ~0.4 s, so it is bytes on the critical path, not CPU. What would move it, all
outside this round's files: split calendar.js / the settings screens out of the boot chunk, move
money.css and premium.css out of the render-blocking stylesheet (PRF-4), and one variable Hanken
Grotesk face instead of five static weights (fonts are 135 kB on Home, more than half the JS).
