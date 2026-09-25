#!/bin/bash
# Irfan ear: Qwen3-ASR-1.7B on vLLM (/v1/audio/transcriptions), port 8001, log /workspace/ear.log
ENV=/workspace/envs/tts
export LD_LIBRARY_PATH=/workspace/cuda-compat-12.9:$LD_LIBRARY_PATH
export HF_HOME=/workspace/hf-home HF_HUB_OFFLINE=1 CUDA_HOME=$ENV PATH=$ENV/bin:$PATH
pid=$(ps -eo pid,args | awk '/vllm serve \/workspace\/models\/Qwen3-ASR/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 5
fi
: > /workspace/ear.log
nohup "$ENV/bin/vllm" serve /workspace/models/Qwen3-ASR-1.7B \
  --served-model-name irfan-ear --port 8001 \
  --gpu-memory-utilization 0.1 --max-model-len 4096 \
  > /workspace/ear.log 2>&1 < /dev/null &
echo $!
