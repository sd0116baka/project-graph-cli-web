# Project Graph CLI + Web Distribution

This fork supports three distribution shapes:

1. Desktop installer: the original Tauri application remains the rich editor for local `.prg` files and backend-managed `server:` projects.
2. Portable backend/Web preview: `scripts/package-portable.ps1` creates a Windows zip with the CLI, backend server, built Web assets, scripts, docs, and smoke tests.
3. CLI package: `@graphif/project-graph-cli` remains the agent-facing command package for offline `.prg`, live bridge, daemon, and backend API calls.

## Portable Preview

Build locally:

```powershell
pnpm run package:portable
```

The zip is written to:

```text
dist\portable\project-graph-cli-web-<version>-windows-preview.zip
```

The preview package requires Node.js 26 or newer on `PATH`; it does not require pnpm or the source checkout. It includes a minimal runtime `node_modules` for the backend and CLI.

After extracting:

```powershell
.\start-web.cmd
.\project-graph.cmd target list --json
.\smoke-web.cmd
```

## Desktop Sidecar Decision

The current Desktop can discover and launch a local backend through `scripts/start-web.ps1`, but the final installer still needs a packaging decision:

- embed the backend as a native sidecar executable,
- bundle a Node runtime plus the portable backend folder,
- or require an external backend daemon.

For this fork, the portable zip is the preview distribution while that decision remains open.

## Upgrade And Data

Default backend data lives under `server\data` inside the runtime root. Production use should pass an explicit data directory:

```powershell
.\start-web.cmd -DataDir D:\ProjectGraphData
```

Before replacing a runtime folder, run:

```powershell
.\backup-data.cmd -DataDir D:\ProjectGraphData
.\smoke-web.cmd -DataDir D:\ProjectGraphData
```

The backend keeps `.prg` history backups per project. The release gate should still include a clean-machine smoke, a LAN smoke, and rollback instructions before a non-preview release.
