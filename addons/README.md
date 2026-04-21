# NanoClaw Lite Add-Ons

Optional extensions that add capabilities to NanoClaw Lite without being required dependencies.

## Available Add-Ons

| Add-On | Description | Requires |
|--------|-------------|----------|
| **oh-my-codex** | Routes coding steps through Codex/Claude/Gemini CLI workers via tmux | `omx-tmux` feature enabled |
| **clawhip** | Discord bridge for agent lifecycle events (#mission-control) | Discord bot token |

## Installing an Add-On

Each add-on has install scripts for Unix and Windows:

```bash
# Unix/macOS/Linux
bash addons/oh-my-codex/install.sh

# Windows (PowerShell)
.\addons\oh-my-codex\install.ps1
```

The install script will:
1. Check prerequisites
2. Copy source files to the appropriate locations
3. Add required environment variables to `.env`
4. Run `npm run build` to compile

## Add-On Structure

```
addons/
  registry.json         # Manifest of all add-ons
  {addon-name}/
    addon.json          # Metadata, version, dependencies
    *.ts                # Source files
    install.sh          # Unix install script
    install.ps1         # Windows install script
```

## Developing Add-Ons

1. Create a directory under `addons/`
2. Add an `addon.json` with metadata
3. Write your source files
4. Create install scripts that copy files + update config
5. Register in `registry.json`

### addon.json Schema

```json
{
  "name": "My Add-On",
  "version": "0.1.0",
  "description": "What it does",
  "requires": [],
  "env": {
    "MY_VAR": { "default": "", "description": "What this var does" }
  }
}
```
