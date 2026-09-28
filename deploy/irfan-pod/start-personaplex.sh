#!/bin/bash
# Warm PersonaPlex with Sruthi's clip. Does not load American voices.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/workspace/envs/personaplex/bin:${PATH:-}"
export PYTHONPATH="/workspace/src/personaplex/moshi${PYTHONPATH:+:$PYTHONPATH}"
export HF_HOME="${HF_HOME:-/workspace/hf-home}"
export PERSONAPLEX_DIR="${PERSONAPLEX_DIR:-/workspace/models/personaplex-7b-v1}"
export SRUTHI_VOICE="${SRUTHI_VOICE:-/workspace/voices/sruthi-clone.wav}"
exec python -u personaplex_pcm.py
