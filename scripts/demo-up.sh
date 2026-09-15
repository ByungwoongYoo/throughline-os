#!/usr/bin/env bash
#
# Bring up a demo stack with the worked example already in it.
#
# Two things this gets right that doing it by hand did not.
#
# The home is DURABLE. Putting it under /tmp cost a whole demo once: the
# database, the account and the example project lived in a session scratch
# directory, which is cleared when the session ends, so everything vanished
# between one look and the next. `~/.throughline-demo` survives reboots and is
# still not the real `~/.throughline`, so nothing here can touch real work.
#
# The API starts BEFORE the worker. Both run database migrations on startup,
# and started together they race: the loser dies with a duplicate key on
# `schema_migrations`, which reads like a corrupt database and is really just
# two processes doing the same setup at once. Waiting for the API to answer
# /health means the migrations are done before the worker looks.
#
# And everything starts under `setsid`. This is the one that cost the most
# time. A process started from a tool call belongs to that call's process
# group, and when the calling session ends the whole group is torn down —
# silently, with no error in any log, so all three simply stopped mid-request
# and looked like a crash with no crash in it. `nohup` does not help: it
# ignores a hangup, and this is not a hangup. `setsid` puts each process in a
# session of its own, which is what actually makes it outlive whoever started
# it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export THROUGHLINE_HOME="${THROUGHLINE_HOME:-$HOME/.throughline-demo}"
PY="$ROOT/.venv/bin/python"
LOGS="$THROUGHLINE_HOME/logs"
WEB_PORT="${WEB_PORT:-3111}"
API_PORT="${API_PORT:-8080}"

EMAIL="${DEMO_EMAIL:-chen@lab.local}"
PASSWORD="${DEMO_PASSWORD:-a-long-enough-passphrase}"
NAME="${DEMO_NAME:-Dr Chen}"

mkdir -p "$LOGS"
echo "home: $THROUGHLINE_HOME"

stop() {
  for pat in "uvicorn throughline_api" "throughline_workers" "next dev.*$WEB_PORT"; do
    pkill -f "$pat" 2>/dev/null || true
  done
  sleep 1
}

wait_for() {  # url, label, tries
  for _ in $(seq 1 "${3:-60}"); do
    if [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$1" 2>/dev/null)" = "200" ]; then
      echo "  $2 up"; return 0
    fi
    sleep 2
  done
  echo "  $2 DID NOT COME UP"; return 1
}

case "${1:-up}" in
  down) stop; echo "stopped"; exit 0 ;;
esac

stop

echo "starting the API"
setsid "$PY" -m uvicorn throughline_api.app:app \
  --host 127.0.0.1 --port "$API_PORT" > "$LOGS/api.log" 2>&1 < /dev/null &
wait_for "http://127.0.0.1:$API_PORT/health" "api"

# Only now: the migrations the API just ran are the ones the worker needs.
echo "starting the worker"
setsid "$PY" -m throughline_workers > "$LOGS/worker.log" 2>&1 < /dev/null &
sleep 3

echo "starting the interface"
cd "$ROOT/apps/web"
setsid npx next dev --turbopack -p "$WEB_PORT" > "$LOGS/web.log" 2>&1 < /dev/null &
wait_for "http://127.0.0.1:$WEB_PORT/" "web"

# ---- the account, and the worked example --------------------------------
API="http://127.0.0.1:$API_PORT"
STATUS=$(curl -s -m 10 "$API/api/auth/status")
COOKIE=""

if echo "$STATUS" | grep -q '"needs_setup":true'; then
  echo "creating the demo account"
  COOKIE=$(curl -s -m 20 -i -X POST "$API/api/auth/setup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"display_name\":\"$NAME\"}" \
    | grep -i '^set-cookie:' | sed 's/.*throughline_session=\([^;]*\).*/\1/' | tr -d '\r')
fi

if [ -z "$COOKIE" ]; then
  COOKIE=$(curl -s -m 20 -i -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    | grep -i '^set-cookie:' | sed 's/.*throughline_session=\([^;]*\).*/\1/' | tr -d '\r')
fi

if [ -z "$COOKIE" ]; then echo "could not sign in"; exit 1; fi
echo "$COOKIE" > "$THROUGHLINE_HOME/session.txt"

COUNT=$(curl -s -m 15 -b "throughline_session=$COOKIE" "$API/api/projects" \
  | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(len(d if isinstance(d,list) else d.get("projects",[])))')

if [ "$COUNT" = "0" ]; then
  echo "building the worked example"
  curl -s -m 180 -X POST -b "throughline_session=$COOKIE" "$API/api/projects/example" > /dev/null
fi

PROJECT=$(curl -s -m 15 -b "throughline_session=$COOKIE" "$API/api/projects" \
  | "$PY" -c 'import json,sys; d=json.load(sys.stdin); p=d if isinstance(d,list) else d.get("projects",[]); print(p[0]["id"] if p else "")')
echo "$PROJECT" > "$THROUGHLINE_HOME/project.txt"

# The example queues its dataset profiling, its analyses and its finding as
# background jobs. Without waiting, the first thing anybody sees is an empty
# project and a "3 steps still running" banner that never resolves.
echo "waiting for the example to finish computing"
for _ in $(seq 1 60); do
  N=$(curl -s -m 15 -b "throughline_session=$COOKIE" "$API/api/projects/$PROJECT/analyses" \
    | "$PY" -c 'import json,sys
try:
  d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)
except Exception: print(0)')
  [ "$N" != "0" ] && { echo "  $N analyses"; break; }
  sleep 3
done

# Prove the detachment rather than assert it: a process in its own session has
# a session id equal to its own pid, and is therefore not in the caller's group.
echo
echo "detached? (SID should equal PID)"
ps -eo pid,sid,comm,args --no-headers 2>/dev/null \
  | grep -E "uvicorn throughline|throughline_workers|next dev.*$WEB_PORT" \
  | grep -v grep \
  | awk '{ printf "  pid=%s sid=%s %s\n", $1, $2, ($1==$2 ? "detached" : "STILL IN CALLER GROUP") }'

echo
echo "open  http://localhost:$WEB_PORT"
echo "sign in  $EMAIL / $PASSWORD"
echo "project  $PROJECT"
echo "logs     $LOGS"
