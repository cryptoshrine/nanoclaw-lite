# Browser Harness

Persistent CDP browser daemon with skill accumulation. Chrome stays running between sessions — no cold starts.

## When to Use

| Tool | Use When |
|------|----------|
| **Browser Harness** | Persistent sessions, login state, skill learning, server-side automation |
| Surfagent | Quick DOM recon, structured data extraction, no visual needs |
| Agent Browser | Visual verification needed, complex multi-step flows |
| Chrome DevTools MCP | Debugging, Lighthouse audits, network inspection |

## Quick Start

### Navigate and Extract
```
browser_harness action=navigate url="https://example.com"
browser_harness action=get_text selector="h1"
browser_harness action=screenshot
```

### Interact with Forms
```
browser_harness action=fill selector="#email" value="user@example.com"
browser_harness action=fill selector="#password" value="secret"
browser_harness action=click selector="button[type=submit]"
browser_harness action=wait_for selector=".dashboard"
```

### Run JavaScript
```
browser_harness action=evaluate expression="document.querySelectorAll('.item').length"
```

## Skill Accumulation

The daemon learns successful browser interaction patterns. After a successful interaction, record it:

```
browser_harness action=skill_record domain="app.example.com" name="login" skill_action="fill_and_click" selector="#login-form" success=true
```

Before interacting with a known site, check for existing skills:

```
browser_harness action=skill_find domain="app.example.com"
```

Execute a known skill:

```
browser_harness action=skill_execute domain="app.example.com" name="login"
```

### Skill Workflow

1. **Check** — `skill_find` for the domain before starting
2. **Execute** — If a skill exists with good success rate, use it
3. **Record** — After any successful interaction, record it as a skill
4. **Prune** — Dead skills (low success rate) are auto-pruned

## Actions Reference

| Action | Required Params | Description |
|--------|----------------|-------------|
| `navigate` | `url` | Go to URL |
| `evaluate` | `expression` | Run JavaScript |
| `click` | `selector` | Click element |
| `fill` | `selector`, `value` | Type into input |
| `screenshot` | (optional: `full_page`) | Capture PNG |
| `wait_for` | `selector` (optional: `timeout`) | Wait for element |
| `get_html` | (optional: `selector`) | Get element HTML |
| `get_text` | (optional: `selector`) | Get element text |
| `get_url` | — | Current page URL |
| `get_title` | — | Current page title |
| `skill_record` | `domain`, `name`, `skill_action` | Record a skill |
| `skill_find` | `domain` (optional: `name`) | Find skills |
| `skill_execute` | `domain`, `name` | Get skill for replay |

## Troubleshooting

**"Daemon not connected"** — The Python daemon isn't running.
```bash
systemctl status browser-harness
systemctl restart browser-harness
```

**"Element not found"** — Selector doesn't match anything. Use `get_html` to inspect the page structure.

**"Timeout"** — Page took too long to load or element didn't appear. Increase timeout or check the URL.

**Skills not persisting** — Check that `~/.browser-harness/skills.db` exists and is writable.
