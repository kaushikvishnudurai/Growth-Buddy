# Deploying Growth Buddy

Three artifacts ship independently: the **API** (Spring Boot), the **web app**
(static `dist/`), and the **mobile shell** (Capacitor, in `../Growth-Buddy-Mobile`).

## The two variables that fail silently

Everything else here either works or breaks loudly. These two don't:

**`SPRING_PROFILES_ACTIVE=prod`** — four separate guards key off this string
(`SessionService`, `MailService`, `DataSeeder`, `AuthService`). Without it the
API boots happily on the public dev HMAC secret, logs OTPs to the console
instead of erroring, and seeds a demo account with a well-known UUID. The
Dockerfile bakes it in so a deploy cannot omit it; if you run the jar directly,
you must set it yourself.

**`VITE_API_BASE`** — read at *build* time and baked into the bundle. Get it
wrong and the app calls the visitor's own machine. The app now throws on
startup rather than doing that quietly, but the only fix is a rebuild — and for
a published mobile binary, an app store update.

## One container, both halves (simplest)

The image builds the frontend and the API together, and the API serves the
bundle. Because both come off one origin the app uses relative paths, so
`VITE_API_BASE` is empty and CORS never applies.

```bash
docker build -f backend/Dockerfile -t growth-buddy .
docker run -p 8080:8080 --env-file prod.env growth-buddy
```

Hosting the frontend separately instead? Build with an explicit
`VITE_API_BASE=https://api.example.com`, deploy `dist/` to a static host, and
set `CORS_ALLOWED_ORIGINS` to that host's origin.

## API

Required (no defaults under the `prod` profile — the app won't start without them):

| Variable | Notes |
|---|---|
| `DB_HOST` `DB_NAME` `DB_USER` `DB_PASSWORD` | |
| `SESSION_HMAC_SECRET` | 32+ random bytes. `openssl rand -base64 48` |
| `CORS_ALLOWED_ORIGINS` | your web origin, comma-separated. Never localhost |

Optional: `DB_SSL_MODE` (defaults to `REQUIRED` in prod — set `DISABLED` only
for a socket-local MySQL), `DB_POOL_SIZE`, `MAIL_USER`/`MAIL_PASS`,
`OPENAI_API_KEY`, `VAPID_*`, `WHATSAPP_*`.

**Schema is not auto-created.** `prod` runs `ddl-auto: validate`; apply
`tableCreationQueries.sql` before the first deploy and before any release that
adds a table. `validate` fails the deploy on drift, which is the intended
behaviour — `update` cannot alter FK-referenced columns and leaves the schema
half-migrated when it tries.

## Web app

```bash
VITE_API_BASE=https://api.example.com npm run build
# deploy dist/ to any static host
```

Spring serves `dist/` when it finds one, with a one-year immutable cache on the
content-hashed assets and `no-cache` on `sw.js` (a hard-cached service worker
pins clients to a dead build). With no `dist/` it falls back to the raw source
tree with caching off — that fallback is what `./run.sh` uses for local
development, and it has no service worker or bundling.

Source maps are emitted as `hidden`: they land in `dist/` but nothing links to
them. Upload them to your error tracker, don't publish them.

## Mobile

```bash
cd ../Growth-Buddy-Mobile
VITE_API_BASE=https://api.example.com npm run sync
```

`npm run sync` rebuilds the web app and copies `dist` into `www`. The API base
is baked in at that moment, so the variable must be set for *this* command, not
at app launch.

Android release builds need a keystore, passed by env — never committed:

```bash
keytool -genkeypair -v -keystore gb-release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias gb

GB_KEYSTORE=$PWD/gb-release.jks GB_KEYSTORE_PASSWORD=... \
GB_KEY_ALIAS=gb GB_KEY_PASSWORD=... ./gradlew assembleRelease
```

Losing that keystore means you can never update the listing again. Back it up
somewhere that isn't this machine.

Bump `versionCode` in `android/app/build.gradle` for every Play Store upload —
it is still `1`.

## WhatsApp reminders

Live on Meta's free test number with the approved `gb_reminder_v2` UTILITY
template, which means delivery only to the 5 allow-listed recipients. Going
wider needs a real business phone number on a verified business. The scheduler
no-ops cleanly when unconfigured, so this never blocks a deploy.

WhatsApp OTP still rides the reminder template: AUTHENTICATION-category
templates are refused until Meta Business Verification completes. Once it does,
create the auth template and set `WHATSAPP_AUTH_TEMPLATE` — `WhatsAppService`
switches to the copy-code shape with no code change. See `.env.example` for the
variables.
