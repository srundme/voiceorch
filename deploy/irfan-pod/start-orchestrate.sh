#!/bin/bash
# Irfan's own call loop. Does not restart the ear, brain, or voice.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/workspace/envs/tts/bin:${PATH:-}"
export HF_HOME="${HF_HOME:-/workspace/hf-home}"
export IRFAN_ORCH_PORT="${IRFAN_ORCH_PORT:-8790}"
export IRFAN_SPOKEN_NAME="${IRFAN_SPOKEN_NAME:-Sruthi}"
exec python -u orchestrate.py
