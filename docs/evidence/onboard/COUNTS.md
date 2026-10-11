# Onboarding input counts: sign-up form to first habit ticked

Before: build 92 (docs/audit/first-run.md, docs/audit/friction-setup.md). After: ov1011/onboard on top of
overhaul/2026-10-11 (build 95), measured by `e2e/onboarding.spec.mjs` (it counts every tap, field and
choice it makes and asserts the budget: at most 6 taps, 4 fields, 1 decision, under 30 s from code to tick).

A tap includes focusing a field. Human seconds use first-run.md's model: 3 s to read a new screen, 1 s per
tap, 0.3 s per character on a phone, 20 s to fetch the code from the mail app.

| Step | Before | After |
|---|---|---|
| Landing | Sign-in "Welcome back"; tap "Create account" (1 tap) | Sign-up is the first screen, with one line on what the app does (0) |
| Sign-up form | Email, Name, Password, Confirm password, Create (5 taps, 4 fields) | Email, Password, Create; Name is optional (3 taps, 2 fields) |
| Code | Tap the field, type 6 digits, tap Verify (2 taps, 1 field) | Field is focused; the sixth digit (or a pasted message) submits (0 taps, 1 field) |
| Setup | Timezone, notifications, 13 feature switches (3 taps, 3 decisions) | One sheet, the Balanced day plan already filled in: "Start with this plan" (1 tap, 1 decision) |
| Plan | Home checklist, "Pick a goal", 2 chips, "Set it up", "Nice!" on the Dreamer modal (5 taps, 1 decision) | Done in the step above; no achievement modal |
| Reach the habit | 3 swipes (habit at y = 1968 of 2433) | 0 swipes: the habits lead Home |
| Tick | 1 tap | 1 tap |
| **Total** | **17 taps, 5 fields, about 4 decisions, 3 swipes** | **5 taps, 3 fields, 1 decision, 0 swipes** |
| Keystrokes | 69 | about 40 (email + password + 6 digits; no name, no second password) |
| Human estimate, landing to tick | about 108 s | about 50 s (20 s of it the mail app) |
| Human estimate, code accepted to tick | about 47 s | about 10 s (read the plan 5 s, tap, see Home 3 s, tap) |
| Machine time, code entered to tick | not measured | 4.0 to 6.0 s (mobile 390x844), 5.1 to 5.9 s (desktop 1280x800) |

Choosing a different pack than the default adds one chip tap (6 taps, still inside the budget).
