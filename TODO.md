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

- [ ] `P4-1` Make lock, conflict, and save failure recovery visible in the Web project list.
- [ ] `P4-2` Surface the active backend address, data directory, and lock state in the Web UI.
- [ ] `P4-3` Route save and patch failures through visible dialogs instead of console-only feedback.
- [ ] `P4-4` Add explicit confirmation and result feedback around history restore.

## Phase 5 - LAN Deployment And Operations

- [ ] `P5-1` Verify start, stop, status, backup, and restore scripts end to end.
- [ ] `P5-2` Make custom data directory handling consistent across every Web script.
- [ ] `P5-3` Document firewall, startup task, logs, backup, and restore as a real Windows workflow.
- [ ] `P5-4` Run one full validation on a normal Windows user machine path.

## Phase 6 - Agent Calling Experience

- [ ] `P6-1` Publish the operation schema and Web server API examples for agents.
- [ ] `P6-2` Document the recommended agent flow: list, query, patch, export or validate.
- [ ] `P6-3` Keep CLI server command output machine-readable with `--json`.
- [ ] `P6-4` Define a minimal stable contract for agent-side retries and conflict recovery.

## Phase 7 - Release And Long-Term Maintenance

- [ ] `P7-1` Sync from upstream `origin/master` regularly to reduce fork drift.
- [ ] `P7-2` Add GitHub Actions for core tests, CLI tests, Web build, and server smoke.
- [ ] `P7-3` Decide whether this remains a long-running fork, becomes upstream PRs, or ships as a separate experimental distribution.
- [ ] `P7-4` Rewrite the README entry points around CLI, Web backend, and desktop live bridge.
