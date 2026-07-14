#!/usr/bin/env bash
# Growth Buddy — start the backend with env vars from .env.
# Usage:  ./run.sh                 # foreground
#         ./run.sh --bg            # background, logs to /tmp/gb-backend.log
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

# Load .env if present. Lines like KEY=value (no quotes needed).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

jar="$repo_root/backend/target/growth-buddy-backend-0.1.0.jar"
if [[ ! -f "$jar" ]] || find "$repo_root/backend/src" "$repo_root/backend/pom.xml" -newer "$jar" -print -quit | grep -q .; then
  echo "Building backend..."
  ( cd backend && mvn -q -DskipTests package )
fi

# Stop any existing instance on 8080.
pids="$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t || true)"
if [[ -n "${pids// /}" ]]; then
  echo "Stopping existing backend on 8080: $pids"
  kill -9 $pids || true
  sleep 1
fi

if [[ "${1:-}" == "--bg" ]]; then
  log=/tmp/gb-backend.log
  : > "$log"
  nohup java -jar "$jar" > "$log" 2>&1 &
  echo "Backend PID $! → logs at $log"
  echo "Open http://localhost:8080/"
else
  echo "Starting backend in foreground. Open http://localhost:8080/"
  exec java -jar "$jar"
fi
