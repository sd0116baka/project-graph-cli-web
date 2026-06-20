# Project Graph CLI + Web Roadmap

Baseline branch: `codex/web-cli-integration`
Fork: `sd0116baka/project-graph-cli-web`

## Phase 0 - Completed Baseline

- [x] `P0-1` Create the GitHub fork and rename it to `project-graph-cli-web`.
- [x] `P0-2` Push `codex/web-cli-integration` to the fork.
- [x] `P0-3` Keep the MVP split clear: `.prg` codec, graph core, CLI, live desktop bridge, and LAN Web server.
- [x] `P0-4` Verify the baseline with core tests, CLI tests, CLI build, Web build, and a temporary Web API smoke test.

## Phase 1 - Unified Backend Operations

- [x] `P1-1` Add headless graph APIs to the Web server: query, patch, and export.
- [x] `P1-2` Reuse `@graphif/prg-codec` and `@graphif/project-graph-core` in the Web server instead of duplicating graph logic.
- [x] `P1-3` Define server-side write concurrency semantics around locks, ETags, and patch base revisions.
- [x] `P1-4` Return stable machine-readable JSON errors for agent callers.

## Phase 2 - CLI Access To The Web Backend

- [x] `P2-1` Add `project-graph server list`.
- [x] `P2-2` Add `project-graph server query <project-id>`.
- [x] `P2-3` Add `project-graph server patch <project-id> ops.json`.
- [x] `P2-4` Add `project-graph server export <project-id>`.
- [x] `P2-5` Support `--url`, `--user`, and `--password`, plus environment variables for agent-friendly authentication.

## Phase 3 - Tests And Safety Boundaries

- [x] `P3-1` Add Web server API integration tests with a temporary data directory.
- [x] `P3-2` Cover query, patch, and export happy paths.
- [x] `P3-3` Cover unauthenticated access, bad credentials, lock conflicts, and ETag conflicts.
- [x] `P3-4` Cover invalid patch payload rejection and backup creation before writes.
- [x] `P3-5` Add CLI server command smoke coverage against a temporary local server.
- [x] `P3-6` Cover thumbnail preservation and concurrent patch conflicts in the real Web server process.

## Phase 4 - Web User Experience

- [x] `P4-1` Make lock, conflict, and save failure recovery visible in the Web project list.
- [x] `P4-2` Surface the active backend address, data directory, and lock state in the Web UI.
- [x] `P4-3` Route save and patch failures through visible dialogs instead of console-only feedback.
- [x] `P4-4` Add explicit confirmation and result feedback around history restore.

## Phase 5 - LAN Deployment And Operations

- [x] `P5-1` Verify start, stop, status, backup, and restore scripts end to end.
- [x] `P5-2` Make custom data directory handling consistent across every Web script.
- [x] `P5-3` Document firewall, startup task, logs, backup, and restore as a real Windows workflow.
- [x] `P5-4` Run one full validation on a normal Windows user machine path.

## Phase 6 - Agent Calling Experience

- [x] `P6-1` Publish the operation schema and Web server API examples for agents.
- [x] `P6-2` Document the recommended agent flow: list, query, patch, export or validate.
- [x] `P6-3` Keep CLI server command output machine-readable with `--json`.
- [x] `P6-4` Define a minimal stable contract for agent-side retries and conflict recovery.

## Phase 7 - Release And Long-Term Maintenance

- [x] `P7-1` Sync from upstream `origin/master` regularly to reduce fork drift.
- [x] `P7-2` Add GitHub Actions for core tests, CLI tests, Web build, and server smoke.
- [x] `P7-3` Decide whether this remains a long-running fork, becomes upstream PRs, or ships as a separate experimental distribution.
- [x] `P7-4` Rewrite the README entry points around CLI, Web backend, and desktop live bridge.

## Next Roadmap - Backend-First Convergence

Target shape: one Project Graph backend is the source of truth. CLI, Desktop, and Web are clients of that backend. The current live bridge remains as a compatibility path until Desktop can use the backend directly.

## Phase 8 - Backend-First Architecture Contract

- [x] `P8-1` Define the backend as the authoritative owner of projects, revisions, locks, history, backups, query, patch, validate, import, and export.
- [x] `P8-2` Specify the client roles for CLI, Desktop, and Web, including what each client may cache locally and what must round-trip through the backend.
- [x] `P8-3` Replace transport-specific concurrency language with one public `revisionToken` concept that can map to ETags, numeric revisions, or future event revisions.
- [x] `P8-4` Document the migration path from live bridge as the main automation route to backend-first automation as the main route.
- [x] `P8-5` Add architecture documentation and diagrams that show backend, CLI, Desktop, Web, storage, and event flows.

## Phase 9 - Backend Daemon And Discovery

- [x] `P9-1` Add first-class daemon commands for start, stop, status, restart, health, and version.
- [x] `P9-2` Write a local backend registry so CLI and Desktop can discover running local backends without hard-coded ports.
- [x] `P9-3` Add backend capability metadata for auth mode, LAN mode, data directory, API version, event support, and supported graph operations.
- [x] `P9-4` Add `project-graph target list --json` to discover local daemon targets, LAN targets provided by URL, and compatibility live sessions.
- [x] `P9-5` Make backend startup idempotent so Desktop and CLI can safely attach to an existing daemon instead of launching duplicates.

## Phase 10 - Unified Project Runtime API

- [x] `P10-1` Normalize project lifecycle APIs: list, create, open/import, rename, delete, blob read/write, query, patch, validate, export, history, restore, lock, and unlock.
- [x] `P10-2` Return `revisionToken` from every read or write response that observes project state.
- [x] `P10-3` Accept `revisionToken` on writes and return stable conflict errors when the token is stale.
- [x] `P10-4` Normalize JSON error contracts across server, live, and offline CLI paths.
- [x] `P10-5` Add integration tests that exercise the same query, patch, validate, export, conflict, and history behavior through the unified API.

## Phase 11 - Desktop As Backend Client

- [x] `P11-1` Let Desktop connect to or launch a local backend daemon during startup.
- [x] `P11-2` Add a Desktop backend status surface showing local URL, LAN URL when enabled, data directory, auth state, and connected clients.
- [x] `P11-3` Route Desktop server-project list, open, save, rename, delete, history, and restore through the backend API.
- [x] `P11-4` Keep direct local file open/save working while making backend-managed projects the default for shared workflows.
- [x] `P11-5` Preserve existing Desktop editing behavior while moving persistence, locks, and history ownership into the backend.

## Phase 12 - Event Sync And Conflict UX

- [x] `P12-1` Add backend event delivery with WebSocket or SSE for project revision changes, lock changes, history changes, and server status changes.
- [x] `P12-2` Update Web to refresh project state from backend events instead of relying only on manual reloads or one-off requests.
- [x] `P12-3` Update Desktop to react to backend events for external CLI/Web changes to the same project.
- [x] `P12-4` Add visible conflict recovery flows in Desktop and Web for stale revisions, expired locks, and changed remote state.
- [x] `P12-5` Add CLI `watch` or `wait` commands for agents that need to observe backend readiness, lock release, or project revision changes.

## Phase 13 - Distribution And Installable Runtime

- [x] `P13-1` Build a portable Windows preview zip containing CLI, backend, built Web assets, scripts, documentation, and smoke tests.
- [x] `P13-2` Add a release workflow that builds and uploads the Desktop installer, portable backend/Web zip, CLI package, and checksums.
- [x] `P13-3` Decide whether Desktop embeds the backend as a sidecar binary, launches the Node backend from a bundled runtime, or connects to an externally installed daemon.
- [x] `P13-4` Add clean-machine install and smoke instructions for Desktop-only, CLI-only, backend-only, and full CLI/Desktop/Web setups.
- [x] `P13-5` Add upgrade and data migration checks for existing server data directories.

## Phase 14 - Hardening, Security, And Compatibility

- [x] `P14-1` Define secure defaults for local-only mode, LAN mode, generated credentials, token storage, and logs.
- [x] `P14-2` Add compatibility checks for API version mismatch between CLI, Desktop, Web, and backend.
- [x] `P14-3` Add backup, restore, and corruption recovery tests for backend-managed project data.
- [x] `P14-4` Add release readiness gates that require CI, clean-machine smoke, LAN smoke, and rollback documentation.
- [x] `P14-5` Decide which backend-first pieces should be proposed upstream and which should stay in the experimental fork.

Evidence: `cli-web-v1.0.0-preview.1` was retagged to `a4cdddb2` on 2026-06-18. Downloaded release assets passed checksum verification, portable LAN auth smoke, portable upgrade/rollback smoke, and downloaded installer silent install/runtime LAN auth/uninstall smoke on this Windows machine.
