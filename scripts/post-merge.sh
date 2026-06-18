#!/bin/bash
set -e

pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push-force

# Gender service ML deps (torch / transformers / speechbrain) are NOT in uv.lock:
# uv can't resolve them because pyproject's [tool.uv.sources] pins them to the
# pytorch-cpu index, which doesn't serve them. Install them deterministically
# from the service's versioned requirements.txt so the runtime always has every
# dependency the voice-analysis handler imports (idempotent — pip skips deps
# already satisfied). Without this, gender detection 500s on a fresh environment.
python3 -m pip install -q -r artifacts/gender-service/requirements.txt
REMOTE_URL="https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/srundme/voiceorch.git"
git remote set-url origin "$REMOTE_URL" 2>/dev/null || git remote add origin "$REMOTE_URL"

set +e
GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="" SSH_ASKPASS="" \
  git -c credential.helper="" push origin "+refs/heads/main:refs/heads/main"
PUSH_EXIT=$?
set -e

if [ $PUSH_EXIT -ne 0 ]; then
  echo ""
  echo "##############################################################"
  echo "WARNING: GitHub push failed (exit code $PUSH_EXIT)."
  echo "Railway will NOT redeploy until the push succeeds."
  echo "Check that GITHUB_PERSONAL_ACCESS_TOKEN is valid and has"
  echo "write access to srundme/voiceorch."
  echo "##############################################################"
  echo ""
fi
