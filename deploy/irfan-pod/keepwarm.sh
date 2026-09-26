#!/usr/bin/env bash
# Every few minutes, touch the brain, voice, ear and the public tunnel so an
# idle night does not leave a cold path, and log anything that stopped answering.
# Usage: nohup bash keepwarm.sh [tunnel_url] > /workspace/keepwarm.log 2>&1 &
TUNNEL="${1:-}"
EVERY="${KEEPWARM_EVERY:-240}"
FRONT="http://127.0.0.1:8787"
SILENCE=/tmp/keepwarm-silence.pcm
head -c 32000 /dev/zero > "$SILENCE"

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

while true; do
  # A live call already keeps the models hot. A warm-up prompt on the shared
  # GPU is what slowed the brain mid-call (call 35632).
  if curl -sf -m 5 "$FRONT/health" | grep -q '"busy": true'; then
    echo "$(stamp) busy, models left alone"
    sleep "$EVERY"
    continue
  fi
  brain=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" -m 30 "$FRONT/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"irfan-brain","messages":[{"role":"user","content":"Say okay."}],"max_tokens":2}')
  voice=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" -m 30 "$FRONT/v1/audio/speech" \
    -H "Content-Type: application/json" -d '{"input":"Okay."}')
  ear=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" -m 30 "$FRONT/v1/audio/transcriptions" \
    --data-binary @"$SILENCE")
  line="$(stamp) brain=$brain voice=$voice ear=$ear"
  if [ -n "$TUNNEL" ]; then
    line="$line tunnel=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" -m 20 "$TUNNEL/health")"
  fi
  echo "$line"
  sleep "$EVERY"
done
