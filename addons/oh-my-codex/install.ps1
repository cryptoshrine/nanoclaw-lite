# Oh My Codex — Add-on installer for NanoClaw Lite (Windows)
# Installs the Codex CLI bridge for OmX tmux worker dispatch.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "../..")

Write-Host "=== Oh My Codex Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..."

if (-not (Test-Path (Join-Path $ProjectRoot "src/omx-tmux.ts"))) {
    Write-Host "ERROR: omx-tmux.ts not found. The OmX tmux engine must be installed first." -ForegroundColor Red
    exit 1
}

# Copy source file
Write-Host "Copying codex-bridge.ts to src/..."
Copy-Item (Join-Path $ScriptDir "codex-bridge.ts") (Join-Path $ProjectRoot "src/codex-bridge.ts") -Force

# Add config entries if not present
$ConfigPath = Join-Path $ProjectRoot "src/config.ts"
$ConfigContent = Get-Content $ConfigPath -Raw
if ($ConfigContent -notmatch "OMX_CODEX_ENABLED") {
    Write-Host "Adding config entries to src/config.ts..."
    $Additions = @"

// Oh My Codex Add-On
import os from 'os';
export const OMX_CODEX_ENABLED = process.env.OMX_CODEX_ENABLED !== 'false';
export const OMX_CODEX_AGENT_TYPE = process.env.OMX_CODEX_AGENT_TYPE || 'codex';
export const OMX_RUNTIME_CLI_PATH = process.env.OMX_RUNTIME_CLI_PATH || '';
export const OMX_CODEX_JOBS_DIR = process.env.OMX_CODEX_JOBS_DIR ||
  path.join(os.homedir(), '.omx', 'team-jobs');
"@
    Add-Content $ConfigPath $Additions
} else {
    Write-Host "Config entries already present — skipping."
}

# Add env vars to .env
$EnvPath = Join-Path $ProjectRoot ".env"
if ((Test-Path $EnvPath) -and ((Get-Content $EnvPath -Raw) -notmatch "OMX_CODEX_ENABLED")) {
    Write-Host "Adding environment variables to .env..."
    $EnvAdditions = @"

# Oh My Codex Add-On
OMX_CODEX_ENABLED=true
OMX_CODEX_AGENT_TYPE=codex
# OMX_RUNTIME_CLI_PATH=C:/path/to/oh-my-codex/dist/team/runtime-cli.js
# OMX_CODEX_JOBS_DIR=~/.omx/team-jobs
"@
    Add-Content $EnvPath $EnvAdditions
}

# Build
Write-Host "Building..."
Set-Location $ProjectRoot
npm run build 2>&1 | Select-Object -Last 5

Write-Host ""
Write-Host "=== Oh My Codex installed ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Set OMX_RUNTIME_CLI_PATH in .env to point to your OMC runtime-cli.js"
Write-Host "  2. Restart NanoClaw Lite"
