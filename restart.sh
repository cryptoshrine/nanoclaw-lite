#!/usr/bin/env bash
# NanoClaw clean restart script
# Kills all child processes cleanly before restarting to prevent zombie sessions.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== NanoClaw Clean Restart ==="

# Step 1: Kill all agent-runner and Claude SDK child processes
echo "→ Killing agent-runner child processes..."
# Kill any node processes running agent-runner dist/index.js
for pid in $(wmic process where "CommandLine like '%agent-runner%dist%index%'" get processid 2>/dev/null | grep -E '^[0-9]+' || true); do
  echo "  Killing agent-runner PID $pid"
  taskkill //PID "$pid" //F 2>/dev/null || true
done

# Kill any node processes running the Claude SDK CLI (spawned by agent-runner)
for pid in $(wmic process where "CommandLine like '%claude-agent-sdk%cli%'" get processid 2>/dev/null | grep -E '^[0-9]+' || true); do
  echo "  Killing Claude SDK PID $pid"
  taskkill //PID "$pid" //F 2>/dev/null || true
done

# Kill ipc-mcp-stdio processes
for pid in $(wmic process where "CommandLine like '%ipc-mcp-stdio%'" get processid 2>/dev/null | grep -E '^[0-9]+' || true); do
  echo "  Killing IPC MCP PID $pid"
  taskkill //PID "$pid" //F 2>/dev/null || true
done

# Step 2: Kill the main NanoClaw process (src/index.ts or dist/index.js)
echo "→ Killing NanoClaw main process..."
for pid in $(wmic process where "CommandLine like '%nanoclaw%src/index%'" get processid 2>/dev/null | grep -E '^[0-9]+' || true); do
  echo "  Killing NanoClaw PID $pid"
  taskkill //PID "$pid" //F 2>/dev/null || true
done

# Also try to kill by port if it's listening on something
sleep 2
echo "→ All processes killed. Waiting for ports to clear..."
sleep 1

# Step 3: Clear session state to prevent orphaned session conflicts
echo "→ Clearing session state..."
SESSIONS_FILE="$SCRIPT_DIR/data/sessions.json"
if [ -f "$SESSIONS_FILE" ]; then
  echo "{}" > "$SESSIONS_FILE"
  echo "  sessions.json cleared"
fi

# Step 4: Restart NanoClaw
echo "→ Starting NanoClaw..."
cd "$SCRIPT_DIR"
npm run dev
