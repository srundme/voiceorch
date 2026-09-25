#!/bin/bash
# Irfan brain: Qwen3-32B-AWQ on vLLM (OpenAI API), port 8000, log /workspace/brain.log
ENV=/workspace/envs/tts
export LD_LIBRARY_PATH=/workspace/cuda-compat-12.9:$LD_LIBRARY_PATH
export HF_HOME=/workspace/hf-home HF_HUB_OFFLINE=1 CUDA_HOME=$ENV PATH=$ENV/bin:$PATH
pid=$(ps -eo pid,args | awk '/vllm serve \/workspace\/models\/Qwen3-32B/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 5
fi
: > /workspace/brain.log
nohup "$ENV/bin/vllm" serve /workspace/models/Qwen3-32B-AWQ \
  --served-model-name irfan-brain --port 8000 \
  --gpu-memory-utilization 0.5 --max-model-len 16384 \
  --enable-prefix-caching \
  --enable-auto-tool-choice --tool-call-parser hermes \
  --default-chat-template-kwargs '{"enable_thinking": false}' \
  > /workspace/brain.log 2>&1 < /dev/null &
echo $!
