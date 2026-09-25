#!/bin/bash
# Irfan front door (no GPU): port 8787, log /workspace/irfan-pod.log
pid=$(ps -eo pid,args | awk '/python -u \/workspace\/irfan-pod\/server.py/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 2
fi
: > /workspace/irfan-pod.log
nohup /workspace/envs/tts/bin/python -u /workspace/irfan-pod/server.py > /workspace/irfan-pod.log 2>&1 < /dev/null &
echo $!
