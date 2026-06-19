# Desktop Backend Runtime

## Decision

The Desktop installer should bundle the same backend runtime shape used by the portable preview.

The runtime directory is:

```text
backend-runtime\
  app\dist\
  server\src\
  scripts\
  packages\project-graph-cli\dist\
  node_modules\...
```

This keeps one backend distribution contract for Desktop, CLI, and Web instead of maintaining a separate native backend path.

## Installer Layout

Tauri v2 supports `bundle.resources`. For an installer build, stage the portable runtime directory first, then map it into the installer resources:

```json
{
  "bundle": {
    "resources": {
      "../../dist/portable/project-graph-cli-web/": "backend-runtime/"
    }
  }
}
```

This fork keeps that mapping in `app/src-tauri/tauri.cli-web.conf.json`. It is enabled by the preview installer build script after `scripts/package-portable.ps1` has staged `dist/portable/project-graph-cli-web`; it is not required for normal app development builds.

Build the preview installer:

```powershell
.\scripts\build-desktop-installer.ps1
```

By default the script rebuilds the portable runtime first, then passes `--no-default-features` to Cargo so the installer smoke can validate packaging without OCR native dependencies. Pass `-SkipPortableBuild` only when the portable runtime was built immediately before the installer step. Pass `-WithDefaultFeatures` when validating the full Desktop feature set.

## Desktop Startup

Desktop backend startup searches in this order:

1. `PROJECT_GRAPH_BACKEND_START_SCRIPT`,
2. `scripts/start-web.ps1` in the current checkout or portable runtime ancestors,
3. `backend-runtime/scripts/start-web.ps1` under the installed Tauri resource directory.

The Desktop server-project browser can launch either backend mode:

- LAN mode is the default. Desktop starts `start-web.ps1` without `-LocalOnly`, keeps Basic auth enabled, and passes generated credentials for its own API calls. The LAN URL and credentials are shown in the backend panel so another device can connect.
- Local-only mode is selected by clearing the LAN checkbox before startup. Desktop passes `-LocalOnly -NoAuth`, binds `127.0.0.1`, and does not expose the helper backend to the LAN.

When the script is found under `backend-runtime`, Desktop startup also:

- forces `-SkipBuild`, because the installed runtime already contains built Web assets,
- passes a writable data directory under the Tauri app data directory:

```text
<AppData>\Project Graph\backend-data
```

This keeps installed resources read-only and prevents backend data from being written under `Program Files` or the installer resource directory.

## Node Runtime

The current preview requires Node.js 26 or newer on `PATH`.

For a non-preview installer, there are two acceptable next steps:

- bundle a Windows Node runtime under `backend-runtime\node\` and make `start-web.ps1` prefer it,
- or keep Node as an installer prerequisite and make the installer check fail early with a clear message.

Bundling Node gives the most predictable user experience. Keeping Node external keeps the installer smaller but makes Desktop backend launch dependent on machine state.

## Release Gate

Before a stable release, validate:

```powershell
pnpm run package:desktop-preview
```

Then install the Desktop package on a clean Windows machine and verify:

- the server-project browser defaults to a LAN backend with Basic auth,
- clearing the LAN checkbox starts a local-only backend,
- the backend registry contains the selected `lanMode`,
- local backend startup does not print a password,
- opening, saving, locking, history, and restore work for `server:` projects,
- uninstalling Desktop does not delete the configured backend data directory.
