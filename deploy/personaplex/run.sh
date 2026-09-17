#!/usr/bin/env bash
set -euo pipefail

SSL_DIR="${SSL_DIR:-/tmp/personaplex-ssl}"
mkdir -p "$SSL_DIR"
if [[ ! -f "$SSL_DIR/key.pem" || ! -f "$SSL_DIR/cert.pem" ]]; then
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$SSL_DIR/key.pem" -out "$SSL_DIR/cert.pem" \
    -days 365 -nodes -subj "/CN=personaplex" >/dev/null 2>&1
fi

if [[ -z "${HF_TOKEN:-}" ]]; then
  echo "HF_TOKEN is required (accept nvidia/personaplex-7b-v1 license on Hugging Face first)" >&2
  exit 1
fi

MOSHI_ARGS=(--host 127.0.0.1 --port 8998 --ssl "$SSL_DIR")
if [[ "${CPU_OFFLOAD:-0}" == "1" ]]; then
  MOSHI_ARGS+=(--cpu-offload)
fi

echo "starting moshi.server ${MOSHI_ARGS[*]}"
python3 -m moshi.server "${MOSHI_ARGS[@]}" &
MOSHI_PID=$!

echo "waiting for moshi on 127.0.0.1:8998 (first boot downloads the 7B weights)"
for _ in $(seq 1 600); do
  if python3 - <<'PY'
import socket
s = socket.socket()
s.settimeout(1)
try:
    s.connect(("127.0.0.1", 8998))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
PY
  then
    echo "moshi is accepting sockets"
    break
  fi
  if ! kill -0 "$MOSHI_PID" 2>/dev/null; then
    echo "moshi.server exited before it was ready" >&2
    wait "$MOSHI_PID" || true
    exit 1
  fi
  sleep 2
done

python3 /app/pcm_bridge.py &
BRIDGE_PID=$!

cleanup() {
  kill "$MOSHI_PID" "$BRIDGE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait -n "$MOSHI_PID" "$BRIDGE_PID"
EXIT=$?
cleanup
exit "$EXIT"
