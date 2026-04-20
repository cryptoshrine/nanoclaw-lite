#!/bin/bash
# NanoClaw Lite + Browser Harness — Server Setup Script
# Run as root on a fresh Ubuntu/Debian server.

set -euo pipefail

INSTALL_DIR="/opt/nanoclaw"
HARNESS_DIR="${INSTALL_DIR}/browser-harness"
SERVICE_USER="nanoclaw"

echo "=== NanoClaw Lite Server Setup ==="

# 1. Create service user
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "[+] Creating user: $SERVICE_USER"
    useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
fi

# 2. Install system dependencies
echo "[+] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    nodejs npm \
    python3 python3-pip python3-venv \
    chromium-browser \
    sqlite3

# 3. Set up NanoClaw
echo "[+] Setting up NanoClaw at ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 4. Set up Browser Harness Python venv
echo "[+] Setting up Browser Harness venv..."
sudo -u "$SERVICE_USER" python3 -m venv "${HARNESS_DIR}/.venv"
sudo -u "$SERVICE_USER" "${HARNESS_DIR}/.venv/bin/pip" install -e "${HARNESS_DIR}"

# 5. Create skills DB directory
echo "[+] Creating skills DB directory..."
sudo -u "$SERVICE_USER" mkdir -p "/home/${SERVICE_USER}/.browser-harness"

# 6. Install systemd services
echo "[+] Installing systemd services..."
cp "$(dirname "$0")/browser-harness.service" /etc/systemd/system/
cp "$(dirname "$0")/nanoclaw-lite.service" /etc/systemd/system/
systemctl daemon-reload

# 7. Enable services
echo "[+] Enabling services..."
systemctl enable browser-harness.service
systemctl enable nanoclaw-lite.service

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy your project files to ${INSTALL_DIR}/"
echo "  2. Create ${INSTALL_DIR}/.env with your config"
echo "  3. Run: npm install --production (in ${INSTALL_DIR})"
echo "  4. Run: npm run build (in ${INSTALL_DIR})"
echo "  5. Start: systemctl start browser-harness nanoclaw-lite"
echo ""
echo "Useful commands:"
echo "  systemctl status browser-harness   # Check daemon status"
echo "  systemctl status nanoclaw-lite     # Check NanoClaw status"
echo "  journalctl -u browser-harness -f   # Stream daemon logs"
echo "  journalctl -u nanoclaw-lite -f     # Stream NanoClaw logs"
