# NanoClaw Debug Checklist

## Quick Status Check

```bash
# 1. Is the service running?
# macOS:
launchctl list | grep nanoclaw
# Linux:
systemctl --user status nanoclaw
# Windows:
# Check your terminal or Task Manager

# 2. Recent errors in service log?
grep -E 'ERROR|WARN' logs/nanoclaw.log | tail -20

# 3. Is Telegram connected? (look for last connection event)
grep -E 'Connected|connection' logs/nanoclaw.log | tail -5

# 4. Are groups loaded?
grep 'groupCount' logs/nanoclaw.log | tail -3
```

## Agent Not Responding

```bash
# Check if messages are being received
grep 'New messages' logs/nanoclaw.log | tail -10

# Check if messages are being processed
grep -E 'Processing messages|Spawning' logs/nanoclaw.log | tail -10

# Check the queue state
grep -E 'Starting|Container active|concurrency limit' logs/nanoclaw.log | tail -10
```

## Session Issues

```bash
# Check session state
sqlite3 store/messages.db "SELECT * FROM sessions;"
```

## Container Issues (Docker mode only)

```bash
# Check running containers
docker ps | grep nanoclaw

# Check stopped containers
docker ps -a | grep nanoclaw

# Check mount validation logs
grep -E 'Mount validated|Mount.*REJECTED' logs/nanoclaw.log | tail -10
```

## Telegram Auth Issues

```bash
# Check for connection errors
grep -E 'ETELEGRAM|401|403' logs/nanoclaw.log | tail -5
```

## Service Management

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw

# Rebuild after code changes
npm run build && npm start

# View live logs
tail -f logs/nanoclaw.log
```
