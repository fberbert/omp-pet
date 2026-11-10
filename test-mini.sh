#!/bin/bash
# Plays every Clawd mini-mode animation in turn.
# Usage: bash test-mini.sh [seconds per animation, default 6]
# Start the app first (npm start).

source "$(dirname "$0")/scripts/dev-port.sh"
DELAY=${1:-6}

SVGS=(
  "clawd-mini-idle.svg"
  "clawd-mini-enter.svg"
  "clawd-mini-peek.svg"
  "clawd-mini-alert.svg"
  "clawd-mini-happy.svg"
  "clawd-mini-crabwalk.svg"
)

STATES=(
  "mini-idle"
  "mini-enter"
  "mini-peek"
  "mini-alert"
  "mini-happy"
  "mini-crabwalk"
)

echo "=== Mini mode demo: ${#SVGS[@]} animations, ${DELAY}s each ==="
for i in "${!SVGS[@]}"; do
  svg="${SVGS[$i]}"
  state="${STATES[$i]}"
  echo "[$((i+1))/${#SVGS[@]}] $state -> $svg"
  curl -s -X POST "$OMP_PET_STATE_URL" \
    -H "Content-Type: application/json" \
    -d "{\"state\":\"$state\",\"svg\":\"$svg\"}"
  sleep "$DELAY"
done

echo ""
echo "Returning to idle..."
curl -s -X POST "$OMP_PET_STATE_URL" \
  -H "Content-Type: application/json" \
  -d '{"state":"idle","svg":"clawd-idle-follow.svg"}'
echo ""
echo "=== DONE ==="
