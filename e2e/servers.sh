#!/usr/bin/env bash
# Starts (or stops) the Firefox and WebKit servers the cross-browser projects connect to.
# Playwright can't launch a browser from inside the test runner on this machine (the child is
# killed with EPERM), but it can from a plain shell, so one node process launches both here and
# the fixtures connect to them over websocket. Chrome projects still attach over CDP (GB_E2E_CDP).
#   e2e/servers.sh start   idempotent; writes endpoints + pid to $GB_E2E_SERVERS
#   e2e/servers.sh stop
set -euo pipefail
cd "$(dirname "$0")/.."
STATE="${GB_E2E_SERVERS:-e2e/.servers.json}"
FF_PORT="${GB_E2E_FF_PORT:-9611}"
WK_PORT="${GB_E2E_WK_PORT:-9612}"

alive() { [ -f "$STATE" ] && kill -0 "$(node -p "require('./$STATE').pid")" 2>/dev/null; }

case "${1:-}" in
  start)
    if alive; then cat "$STATE"; exit 0; fi
    rm -f "$STATE"
    STATE="$STATE" FF_PORT="$FF_PORT" WK_PORT="$WK_PORT" nohup node --input-type=module -e '
      import { firefox, webkit } from "@playwright/test";
      import { writeFileSync } from "node:fs";
      const ff = await firefox.launchServer({ host: "localhost", port: +process.env.FF_PORT, wsPath: "gb" });
      const wk = await webkit.launchServer({ host: "localhost", port: +process.env.WK_PORT, wsPath: "gb" });
      writeFileSync(process.env.STATE, JSON.stringify({ pid: process.pid, firefox: ff.wsEndpoint(), webkit: wk.wsEndpoint() }, null, 2));
      const bye = async () => { await Promise.allSettled([ff.close(), wk.close()]); process.exit(0); };
      process.on("SIGTERM", bye); process.on("SIGINT", bye);
    ' > "${STATE%.json}.log" 2>&1 &
    for _ in $(seq 60); do [ -f "$STATE" ] && break; sleep 0.5; done
    [ -f "$STATE" ] || { echo "browser servers did not start:"; cat "${STATE%.json}.log"; exit 1; }
    cat "$STATE"
    ;;
  stop)
    alive && kill "$(node -p "require('./$STATE').pid")" || true
    rm -f "$STATE"
    ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
