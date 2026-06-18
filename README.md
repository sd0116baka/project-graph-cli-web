# Project Graph CLI + Web Fork

This fork keeps the original Project Graph desktop application and adds two agent-oriented surfaces:

- A CLI for inspecting, querying, patching, validating, importing, and exporting `.prg` documents.
- A LAN Web backend so one machine can host Project Graph projects for browsers and local agents on the same network.

The upstream desktop product remains documented in [app/README.md](app/README.md). This root README is the entry point for the CLI/Web fork.

## Entry Points

| Area                | What it is for                                       | Start here                     |
| ------------------- | ---------------------------------------------------- | ------------------------------ |
| Desktop app         | Original Tauri + React graph editor.                 | [app/README.md](app/README.md) |
| CLI                 | Agent-facing `.prg` and Web backend commands.        | [README-cli.md](README-cli.md) |
| Desktop live bridge | CLI automation against a running desktop graph.      | [README-cli.md](README-cli.md) |
| LAN Web backend     | Shared backend and browser UI for local network use. | [README-web.md](README-web.md) |

The backend-first convergence plan is documented in [docs/backend-first-architecture.md](docs/backend-first-architecture.md).
Distribution and portable preview packaging are documented in [docs/distribution.md](docs/distribution.md).
Backend security and compatibility gates are documented in [docs/security.md](docs/security.md).

## Development Setup

Requirements:

- Node.js 26 or newer.
- pnpm 11.x.
- Rust and Tauri prerequisites only when building the desktop app.

Install dependencies:

```powershell
pnpm install
```

Build the headless packages and Web frontend:

```powershell
pnpm run web:build
```

Run the Web backend locally:

```powershell
.\start-web.cmd
```

Run the agent-facing CLI from source after building it:

```powershell
pnpm nx build @graphif/project-graph-cli
node .\packages\project-graph-cli\dist\index.mjs server list --json
```

## Validation

Core checks for this fork:

```powershell
pnpm nx build @graphif/project-graph-core
pnpm --filter @graphif/prg-codec test
pnpm --filter @graphif/project-graph-core test
pnpm --filter @graphif/project-graph-cli test
pnpm --filter @graphif/project-graph-cli type-check
pnpm --filter @graphif/project-graph-web-server test
pnpm nx build @graphif/project-graph-cli
pnpm run web:build
```

Full local Web smoke flow:

```powershell
.\start-web.cmd -SkipBuild -NoAuth
.\smoke-web.cmd
.\stop-web.cmd
```

The GitHub Actions workflow `CLI and Web` runs the same CI-oriented subset on Windows, including a real temporary Web server smoke test.

## Fork Strategy

This repository is currently maintained as an experimental CLI/Web fork of `graphif/project-graph`.

The maintenance policy is:

- Keep `origin/master` fetchable and check drift before release-oriented work.
- Keep CLI, headless graph logic, Web server, and LAN operations covered by CI before pushing shared branches.
- Keep fork-only behavior documented in this root README, [README-cli.md](README-cli.md), and [README-web.md](README-web.md).
- Split upstreamable work into focused upstream PRs later, after the CLI/Web contract stabilizes.

Upstream drift check:

```powershell
git fetch origin master --prune
git rev-list --left-right --count HEAD...origin/master
```

Current fork remote:

```text
sd0116baka/project-graph-cli-web
```
