#!/bin/bash
# Qwen3-TTS voice clone served by vLLM-Omni on the Krutrim A100 pod (driver 550 / CUDA 12.4).
set -e
export PATH=/opt/conda/bin:$PATH
ENV=/workspace/envs/tts
export HF_HOME=/workspace/hf-home PIP_CACHE_DIR=/workspace/pip-cache UV_CACHE_DIR=/workspace/uv-cache

[ -d "$ENV" ] || conda create -y -p "$ENV" python=3.12
# CUDA 12.9 forward compatibility (575.x) so cu129 wheels run on the 550 driver; newer compat builds fail with error 803
COMPAT=/workspace/cuda-compat-12.9
if [ ! -f "$COMPAT/libcuda.so.1" ]; then
  F=cuda-compat-12-9_575.57.08-0ubuntu1_amd64.deb
  mkdir -p /tmp/c129 "$COMPAT" && cd /tmp/c129
  curl -sfO "https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/$F"
  dpkg-deb -x "$F" . && cp -a usr/local/cuda-12.9/compat/* "$COMPAT/"
fi
PY="$ENV/bin/python"
# vLLM compiles some kernels at startup and needs nvcc + CUDA headers (CUDA_HOME=$ENV in start-tts.sh)
conda install -y -p "$ENV" -c nvidia/label/cuda-12.9.1 cuda-nvcc cuda-cudart-dev cuda-cccl cuda-nvrtc-dev libcublas-dev libcurand-dev
[ -e "$ENV/lib64" ] || ln -s "$ENV/targets/x86_64-linux/lib" "$ENV/lib64"
"$PY" -m pip install -U pip uv
"$PY" -m uv pip install --python "$PY" \
  'https://github.com/vllm-project/vllm/releases/download/v0.30.0/vllm-0.30.0%2Bcu129-cp38-abi3-manylinux_2_28_x86_64.whl' \
  --torch-backend=cu129
"$PY" -m uv pip install --python "$PY" vllm-omni==0.30.0

"$ENV/bin/hf" download Qwen/Qwen3-TTS-12Hz-1.7B-Base --local-dir /workspace/models/Qwen3-TTS-1.7B-Base

LD_LIBRARY_PATH="$COMPAT:$LD_LIBRARY_PATH" "$PY" -c "import torch, vllm, vllm_omni; print('torch', torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0)); print('vllm', vllm.__version__)"
echo ALL_DONE
