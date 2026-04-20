# Browser Harness

Persistent CDP (Chrome DevTools Protocol) daemon with skill accumulation for NanoClaw Lite.

## Architecture

```
Agent → MCP tool → Bridge (Unix socket) → Python Daemon → CDP → Chrome
                                                ↕
                                          skills.db (learns over time)
```

## Install

```bash
cd browser-harness
pip install -e .
```

## Run

```bash
browser-harness
# or
python -m browser_harness.daemon
```

## Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_PATH` | `/usr/bin/chromium-browser` | Path to Chrome/Chromium binary |
| `BROWSER_HARNESS_SOCKET` | `/run/browser-harness/daemon.sock` | Unix socket path |
| `SKILLS_DB_PATH` | `~/.browser-harness/skills.db` | Skills database location |
| `NAV_TIMEOUT` | `30` | Navigation timeout (seconds) |
| `ACTION_TIMEOUT` | `10` | Action timeout (seconds) |

## JSON-RPC Methods

### Browser Actions
- `navigate` — Navigate to URL
- `evaluate` — Execute JavaScript
- `click` — Click element by selector
- `fill` — Fill input by selector
- `screenshot` — Capture page screenshot
- `wait_for` — Wait for element to appear
- `get_html` — Get element HTML
- `get_text` — Get element text
- `get_url` — Get current URL
- `get_title` — Get page title

### Skill Accumulation
- `skill_record` — Record a skill attempt
- `skill_find` — Find skills for a domain
- `skill_execute` — Get skill details for replay
- `skill_stats` — Get overall statistics
- `skill_prune` — Remove dead skills

### System
- `health` — Health check with Chrome PID and stats
