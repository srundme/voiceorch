#!/bin/bash
# Voice: trained Sruthi speaker. Port 8091.
ENV=/workspace/envs/tts
MODEL=${IRFAN_TTS_MODEL:-/workspace/voices/sruthi-ft/output/checkpoint-epoch-2}
export LD_LIBRARY_PATH=/workspace/cuda-compat-12.9:$LD_LIBRARY_PATH
export HF_HOME=/workspace/hf-home HF_HUB_OFFLINE=1 CUDA_HOME=$ENV PATH=$ENV/bin:$PATH
pid=$(ps -eo pid,args | awk '/vllm serve/ && /--port 8091/ && $0 !~ /awk/ {print $1}')
if [ -n "$pid" ]; then
  kill $pid
  sleep 5
fi
SRC=$("$ENV/bin/python" -c "import vllm_omni,os;print(os.path.dirname(vllm_omni.__file__))" 2>/dev/null | tail -1)/deploy/qwen3_tts.yaml
CFG=/workspace/irfan-pod/qwen3_tts_irfan.yaml
sed -e 's/gpu_memory_utilization: 0.3/gpu_memory_utilization: 0.1/' \
    -e 's/max_num_seqs: 64/max_num_seqs: 8/' "$SRC" > "$CFG"
# The talker stage sees the same Ryan speaker on every line.
awk 'BEGIN{n=0} /enable_prefix_caching: false/{n++; if(n==1){sub("false","true")}} {print}' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
: > /workspace/tts.log
nohup "$ENV/bin/vllm" serve "$MODEL" \
  --deploy-config "$CFG" --omni --port 8091 --trust-remote-code \
  > /workspace/tts.log 2>&1 < /dev/null &
echo $!
