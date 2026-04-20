"""Configuration for the browser harness daemon."""

import os
from pathlib import Path


# Chrome/Chromium binary path
CHROME_PATH = os.environ.get(
    "CHROME_PATH",
    "/usr/bin/chromium-browser"
)

# Chrome flags for headless operation
CHROME_FLAGS = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",  # Random port
    "--window-size=1280,720",
]

# Unix socket path for IPC
SOCKET_PATH = os.environ.get(
    "BROWSER_HARNESS_SOCKET",
    "/run/browser-harness/daemon.sock"
)

# Skills database path
SKILLS_DB_PATH = os.environ.get(
    "SKILLS_DB_PATH",
    str(Path.home() / ".browser-harness" / "skills.db")
)

# Timeouts (seconds)
NAVIGATION_TIMEOUT = int(os.environ.get("NAV_TIMEOUT", "30"))
ACTION_TIMEOUT = int(os.environ.get("ACTION_TIMEOUT", "10"))
SCREENSHOT_TIMEOUT = int(os.environ.get("SCREENSHOT_TIMEOUT", "5"))

# Skill accumulation settings
SKILL_EMA_ALPHA = 0.3  # Exponential moving average smoothing factor
SKILL_PRUNE_THRESHOLD = 0.1  # Prune skills with success rate below this
SKILL_MIN_ATTEMPTS = 5  # Minimum attempts before pruning applies
