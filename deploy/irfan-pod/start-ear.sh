#!/bin/bash
# Irfan ear: Whisper large-v3-turbo, port 8001, log /workspace/ear.log
ENV=/workspace/envs/tts
export LD_LIBRARY_PATH=/workspace/cuda-compat-12.9:${LD_LIBRARY_PATH:-}
export HF_HOME=/workspace/hf-home HF_HUB_OFFLINE=1 CUDA_HOME=$ENV PATH=$ENV/bin:$PATH
pid=$(ps -eo pid,args | awk '/vllm serve \/workspace\/models\/Qwen3-ASR/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 5
fi
pid=$(ps -eo pid,args | awk '/ear_parakeet.py|ear_whisper.py/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 2
fi
: > /workspace/ear.log
nohup "$ENV/bin/python" -u /workspace/irfan-pod/ear_whisper.py \
  > /workspace/ear.log 2>&1 < /dev/null &
echo $!
