#!/usr/bin/env bash
set -euo pipefail

# Clawhip — Discord Lifecycle Bridge installer for NanoClaw Lite
# Posts agent lifecycle events to Discord #mission-control.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Clawhip Installer ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

# Install discord.js if not present
if ! node -e "require('discord.js')" 2>/dev/null; then
  echo "Installing discord.js..."
  cd "$PROJECT_ROOT"
  npm install discord.js
else
  echo "discord.js already installed."
fi

# Copy source file
echo "Copying lifecycle-bridge.ts to src/..."
cp "$SCRIPT_DIR/lifecycle-bridge.ts" "$PROJECT_ROOT/src/lifecycle-bridge.ts"

# Add env vars to .env if it exists
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ] && ! grep -q "DISCORD_CHANNEL_MISSION_CONTROL" "$ENV_FILE" 2>/dev/null; then
  echo "Adding environment variables to .env..."
  cat >> "$ENV_FILE" << 'EOF'

# Clawhip Add-On (Discord Lifecycle Bridge)
# DISCORD_BOT_TOKEN=your-bot-token-here
# DISCORD_GUILD_ID=your-guild-id-here
# DISCORD_CHANNEL_MISSION_CONTROL=your-channel-id-here
EOF
fi

# Build
echo "Building..."
cd "$PROJECT_ROOT"
npm run build 2>&1 | tail -5

echo ""
echo "=== Clawhip installed ==="
echo ""
echo "Next steps:"
echo "  1. Create a Discord bot at https://discord.com/developers/applications"
echo "  2. Invite the bot to your server with Send Messages + Embed Links permissions"
echo "  3. Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_MISSION_CONTROL in .env"
echo "  4. Restart NanoClaw Lite"
