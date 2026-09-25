#!/bin/bash
pid=$(ps -eo pid,args | awk '/python3 -u \/workspace\/irfan-pod\/server.py/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 2
fi
export PATH=/opt/conda/bin:$PATH
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
: > /workspace/irfan-pod.log
nohup python3 -u /workspace/irfan-pod/server.py > /workspace/irfan-pod.log 2>&1 &
echo $!
