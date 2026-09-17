# NVIDIA PersonaPlex 7B self-host for SnapServe intake.
# Needs a GPU with ≥24 GB VRAM (A100 40GB / L40S / H100). First boot downloads
# nvidia/personaplex-7b-v1 from Hugging Face (~weights + voices).
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    PCM_BRIDGE_HOST=0.0.0.0 \
    PCM_BRIDGE_PORT=9000 \
    MOSHI_URL=wss://127.0.0.1:8998/api/chat

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git git-lfs \
    libopus-dev ffmpeg openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 https://github.com/NVIDIA/personaplex.git /app/personaplex \
    && pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir /app/personaplex/moshi/. websockets numpy accelerate

COPY pcm_bridge.py /app/pcm_bridge.py
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

EXPOSE 9000 8998
VOLUME ["/models"]

CMD ["/app/run.sh"]
