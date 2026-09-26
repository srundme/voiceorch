#!/bin/bash
# Bring up Irfan on the pod: voice, brain, ear, then the front door on 8787.
cd /workspace/irfan-pod
wait_up() {
  for _ in $(seq 1 60); do
    [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "localhost:$1/health")" = 200 ] && return 0
    sleep 10
  done
  echo "port $1 did not come up" >&2
  return 1
}
bash start-tts.sh && wait_up 8091 || exit 1
# The clone checkpoint is the only one that takes an uploaded clip.
if [ "${IRFAN_VOICE_NAME:-ryan}" = "irfan" ] && ! curl -s localhost:8091/v1/audio/voices | grep -q '"irfan"'; then
  curl -s -X POST localhost:8091/v1/audio/voices -F "audio_sample=@/workspace/voices/irfan-clone.wav" \
    -F "consent=owner-approved-irfan" -F "name=irfan" -F "ref_text=$(cat /workspace/voices/irfan-clone.txt)" > /dev/null
fi
bash start-brain.sh && wait_up 8000 || exit 1
bash start-ear.sh && wait_up 8001 || exit 1
bash restart.sh && sleep 3
curl -s localhost:8787/health
echo
