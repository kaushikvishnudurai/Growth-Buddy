# Cross-browser audit (XB)

Run: `e2e/smoke.spec.mjs` with `GB_E2E_ALL=1` on desktop-chrome, mobile-chrome (Pixel 7), tablet-chrome
(iPad gen 7), desktop-firefox (Firefox 157), desktop-webkit and mobile-webkit (iPhone 14, WebKit 27.2),
against the merged-build backend on :8590. The `guard` fixture fails a test on any console error, page
error, HTTP >= 400 or failed request, so a pass means every screen booted clean in that engine.

Result: 72/72 in 3.1 min with `GB_E2E_CHROME=server` (every project 12/12). No engine-specific app failure.
Chrome-project failures seen during the runs were all timeouts (`page.screenshot` / `locator.fill`
exceeding 60 s) in the shared CDP Chrome on :9591, which other sessions load concurrently; the same
tests pass when re-run, and the same app pages pass in Firefox and WebKit in 4-8 s. That is test
infrastructure contention, not an app bug (its /json/version took 3 s to answer); with the Chrome
projects on servers.sh's own Chromium they pass in 4-8 s like the other engines.

No XB findings. The smoke spec only boots each screen; interaction-level differences (date inputs,
`dialog` focus, backdrop-filter, touch) are not covered until the deeper specs run on these projects.
