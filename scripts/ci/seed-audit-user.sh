#!/usr/bin/env bash
# Growth Buddy — seed the verified account scripts/ui-audit.mjs signs in with (CI).
#
# DataSeeder's demo user has no password credential, so it can't sign in through
# the form. This signs a user up through the real API (so the bcrypt hash is the
# app's own), marks the email verified in SQL (CI has no inbox — the OTP only
# goes to the backend log), signs in, and creates what the dialog phase needs:
# a note (the note sheet) and a RECURRING reminder (the delete-scope dialog),
# plus a one-off reminder so the calendar isn't a single row.
#
# Env: API (default http://localhost:8080), GB_AUDIT_EMAIL, GB_AUDIT_PASSWORD,
#      MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PWD, DB_NAME.
set -euo pipefail

API="${API:-http://localhost:8080}"
EMAIL="${GB_AUDIT_EMAIL:?GB_AUDIT_EMAIL is required}"
PASSWORD="${GB_AUDIT_PASSWORD:?GB_AUDIT_PASSWORD is required}"
DB="${DB_NAME:-growth_buddy}"
TODAY="$(date -u +%F)"

post() { # post <path> <json> [token]
  curl -fsS -X POST "$API$1" -H 'Content-Type: application/json' \
    ${3:+-H "Authorization: Bearer $3"} --data "$2"
}

echo "signup $EMAIL"
post /api/auth/signup "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Audit\",\"timezone\":\"UTC\"}" >/dev/null

mysql -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-3306}" -u "${MYSQL_USER:-root}" "$DB" \
  -e "UPDATE users SET email_verified = TRUE WHERE email = '$EMAIL';"

TOKEN="$(post /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).token;if(!t)process.exit(1);process.stdout.write(t)})')"

echo "seed note + reminders for $TODAY"
post /api/notes '{"title":"Audit note","body":"<p>Seeded by CI for the UI audit.</p>"}' "$TOKEN" >/dev/null
post /api/reminders "{\"text\":\"Daily stand-up\",\"date\":\"$TODAY\",\"time\":\"09:00\",\"tag\":\"work\",\"repeat\":\"daily\"}" "$TOKEN" >/dev/null
post /api/reminders "{\"text\":\"Dentist\",\"date\":\"$TODAY\",\"time\":\"15:30\",\"tag\":\"health\",\"repeat\":\"none\"}" "$TOKEN" >/dev/null
echo "seeded"
