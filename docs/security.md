# Backend Security And Compatibility

## Modes

Local-only mode is for Desktop-launched helper backends. It binds `127.0.0.1`, writes `lanMode: false` to the backend registry, and may run without Basic auth because it is not exposed to the LAN.

LAN mode is for shared browser, CLI, and Desktop access. It binds `0.0.0.0`, writes a LAN URL to the backend registry, and keeps Basic auth enabled by default.

The Desktop server-project browser defaults to LAN mode when launching a backend. Clearing the LAN checkbox before startup switches it to local-only mode; once Desktop starts a backend, the checkbox is locked until that backend is stopped.

## Credentials

Desktop LAN startup uses an administrator user and password configured in the server-project browser. The first LAN startup for a backend data directory requires the password; later launches read and reuse that directory's `auth.json`.

`start-web.ps1` persists explicit credentials passed by Desktop or CLI. If auth is enabled from the script without a password and no previous credential file exists, it still generates a random password for script-only use. Credentials are stored in:

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
.\scripts\smoke-lan-auth.ps1
.\scripts\smoke-upgrade-rollback.ps1
pnpm run package:portable -- -SkipBuild
.\scripts\check-release-readiness.ps1
```

Release validation should also include:

- clean-machine portable zip smoke,
- Desktop installer smoke,
- backup/restore smoke against a real existing data directory,
- rollback instructions for replacing the backend runtime folder.
