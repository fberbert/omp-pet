#!/bin/bash
# Exercises the one-shot animation gates with OMP events.
# Usage:
#   bash test-oneshot-gate.sh             # all states, 6s apart
#   bash test-oneshot-gate.sh error       # one state
#   bash test-oneshot-gate.sh all 10      # all states, 10s apart
#
# Turn a row off in Settings -> Animation Map, run the script and check the
# pet skips that animation; turn it back on and check it plays again.

source "$(dirname "$0")/scripts/dev-port.sh"
STATE=${1:-all}
DELAY=${2:-6}

# state -> OMP event name (see agents/omp.js)
get_event() {
  case $1 in
    error)     echo "PostToolUseFailure" ;;
    sweeping)  echo "PreCompact" ;;
    attention) echo "Stop" ;;
    *) echo "" ;;
  esac
}

send_state() {
  local state=$1
  local event
  event=$(get_event "$state")
  local sid="omp:test-${state}-$(date +%s)"
  local payload="{\"state\":\"$state\",\"event\":\"$event\",\"session_id\":\"$sid\",\"agent_id\":\"omp\"}"
  printf -- "-> [%-9s] event=%-20s " "$state" "$event"
  curl -s -X POST "$OMP_PET_STATE_URL" -H "Content-Type: application/json" -d "$payload" -w "HTTP %{http_code}\n"
}

if ! curl -s "$OMP_PET_STATE_URL" | grep -q '"ok":true'; then
  echo "The pet is not running at ${OMP_PET_STATE_URL}. Start it with npm start."
  exit 1
fi

if [ "$STATE" = "all" ]; then
  echo "=== One-shot gates: 3 states, ${DELAY}s apart ==="
  for s in error sweeping attention; do
    send_state "$s"
    sleep "$DELAY"
  done
  echo "=== DONE ==="
else
  if [ -z "$(get_event "$STATE")" ]; then
    echo "Unknown state: $STATE (valid: error | sweeping | attention | all)"
    exit 1
  fi
  send_state "$STATE"
fi
