# Clawhip — Discord Lifecycle Bridge installer for NanoClaw Lite (Windows)
# Posts agent lifecycle events to Discord #mission-control.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "../..")

Write-Host "=== Clawhip Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..."

# Install discord.js if not present
try {
    node -e "require('discord.js')" 2>$null
    Write-Host "discord.js already installed."
} catch {
    Write-Host "Installing discord.js..."
    Set-Location $ProjectRoot
    npm install discord.js
}

# Copy source file
Write-Host "Copying lifecycle-bridge.ts to src/..."
Copy-Item (Join-Path $ScriptDir "lifecycle-bridge.ts") (Join-Path $ProjectRoot "src/lifecycle-bridge.ts") -Force

# Add env vars to .env
$EnvPath = Join-Path $ProjectRoot ".env"
if ((Test-Path $EnvPath) -and ((Get-Content $EnvPath -Raw) -notmatch "DISCORD_CHANNEL_MISSION_CONTROL")) {
    Write-Host "Adding environment variables to .env..."
    $EnvAdditions = @"

# Clawhip Add-On (Discord Lifecycle Bridge)
# DISCORD_BOT_TOKEN=your-bot-token-here
# DISCORD_GUILD_ID=your-guild-id-here
# DISCORD_CHANNEL_MISSION_CONTROL=your-channel-id-here
"@
    Add-Content $EnvPath $EnvAdditions
}

# Build
Write-Host "Building..."
Set-Location $ProjectRoot
npm run build 2>&1 | Select-Object -Last 5

Write-Host ""
Write-Host "=== Clawhip installed ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Create a Discord bot at https://discord.com/developers/applications"
Write-Host "  2. Invite the bot to your server with Send Messages + Embed Links permissions"
Write-Host "  3. Set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_MISSION_CONTROL in .env"
Write-Host "  4. Restart NanoClaw Lite"
