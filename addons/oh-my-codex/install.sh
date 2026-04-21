#!/usr/bin/env bash
set -euo pipefail

# Oh My Codex — Add-on installer for NanoClaw Lite
# Installs the Codex CLI bridge for OmX tmux worker dispatch.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Oh My Codex Installer ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v tmux &>/dev/null; then
  echo "WARNING: tmux not found. Oh My Codex requires tmux for worker panes."
  echo "Install tmux: brew install tmux (macOS) or apt install tmux (Linux)"
fi

if [ ! -f "$PROJECT_ROOT/src/omx-tmux.ts" ]; then
  echo "ERROR: omx-tmux.ts not found. The OmX tmux engine must be installed first."
  echo "This is a core feature — check that your nanoclaw-lite is up to date."
  exit 1
fi

# Copy source file
echo "Copying codex-bridge.ts to src/..."
cp "$SCRIPT_DIR/codex-bridge.ts" "$PROJECT_ROOT/src/codex-bridge.ts"

# Add config entries if not present
CONFIG="$PROJECT_ROOT/src/config.ts"
if ! grep -q "OMX_CODEX_ENABLED" "$CONFIG" 2>/dev/null; then
  echo "Adding config entries to src/config.ts..."
  cat >> "$CONFIG" << 'EOF'

// Oh My Codex Add-On
import os from 'os';
export const OMX_CODEX_ENABLED = process.env.OMX_CODEX_ENABLED !== 'false';
export const OMX_CODEX_AGENT_TYPE = process.env.OMX_CODEX_AGENT_TYPE || 'codex';
export const OMX_RUNTIME_CLI_PATH = process.env.OMX_RUNTIME_CLI_PATH || '';
export const OMX_CODEX_JOBS_DIR = process.env.OMX_CODEX_JOBS_DIR ||
  path.join(os.homedir(), '.omx', 'team-jobs');
EOF
else
  echo "Config entries already present — skipping."
fi

# Add env vars to .env if it exists
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ] && ! grep -q "OMX_CODEX_ENABLED" "$ENV_FILE" 2>/dev/null; then
  echo "Adding environment variables to .env..."
  cat >> "$ENV_FILE" << 'EOF'

# Oh My Codex Add-On
OMX_CODEX_ENABLED=true
OMX_CODEX_AGENT_TYPE=codex
# OMX_RUNTIME_CLI_PATH=/path/to/oh-my-codex/dist/team/runtime-cli.js
# OMX_CODEX_JOBS_DIR=~/.omx/team-jobs
EOF
fi

# Build
echo "Building..."
cd "$PROJECT_ROOT"
npm run build 2>&1 | tail -5

echo ""
echo "=== Oh My Codex installed ==="
echo ""
echo "Next steps:"
echo "  1. Set OMX_RUNTIME_CLI_PATH in .env to point to your OMC runtime-cli.js"
echo "  2. Ensure tmux is installed"
echo "  3. Restart NanoClaw Lite"
