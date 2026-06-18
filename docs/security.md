# Backend Security And Compatibility

## Modes

Local-only mode is for Desktop-launched helper backends. It binds `127.0.0.1`, writes `lanMode: false` to the backend registry, and may run without Basic auth because it is not exposed to the LAN.

LAN mode is for shared browser, CLI, and Desktop access. It binds `0.0.0.0`, writes a LAN URL to the backend registry, and keeps Basic auth enabled by default.

## Credentials

`start-web.ps1` generates a random password when auth is enabled and no password exists. Credentials are stored in:

```text
<DataDir>\auth.json
```

Do not commit `auth.json`, logs, or backend data directories. CLI callers should prefer `PROJECT_GRAPH_SERVER_USER` and `PROJECT_GRAPH_SERVER_PASSWORD` for automation.

## Logs

Desktop startup passes a log path to `start-web.ps1` so launch failures have a visible file to inspect. Logs must not print generated passwords unless the user explicitly starts the backend without `-LogPath`.

## API Compatibility

The public backend API version is currently:

```text
0.1
```

The CLI checks `/api/server-info` before server project operations when that endpoint is available. If the backend reports a different API version, the CLI returns `api_version_mismatch` and does not continue with the requested operation.

## Release Gates

Before a non-preview release, run:

```powershell
pnpm --filter @graphif/project-graph-cli test
pnpm --filter @graphif/project-graph-web-server test
pnpm run package:portable -- -SkipBuild
.\scripts\check-release-readiness.ps1
```

Release validation should also include:

- clean-machine portable zip smoke,
- LAN smoke with auth enabled,
- Desktop installer smoke,
- backup/restore smoke against an existing data directory,
- rollback instructions for replacing the backend runtime folder.
