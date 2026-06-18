# Project Graph CLI

The CLI is the agent-facing entry point for Project Graph documents. It supports two editing paths:

- Offline file transforms: read a `.prg`, apply a patch, and write a new `.prg`.
- Live GUI bridge: connect to a running GUI started with `--live`, mutate the in-memory stage, and save by default.

## Build

```powershell
pnpm --filter @graphif/project-graph-cli build
```

## Inspect and Validate

```powershell
project-graph inspect .\graph.prg
project-graph inspect .\graph.prg --json
project-graph validate .\graph.prg
```

## Import and Export

```powershell
project-graph import .\outline.md -o .\graph.prg
project-graph import .\flow.mmd -o .\graph.prg
project-graph import .\graph.pg.json -o .\graph.prg

project-graph export .\graph.prg --format pgjson -o .\graph.pg.json
project-graph export .\graph.prg --format markdown -o .\outline.md
project-graph export .\graph.prg --format mermaid -o .\flow.mmd
```

## Patch Files

`project-graph patch` accepts either an array of operations or an object with an `ops` array.

```json
[
  {
    "op": "add_text_node",
    "id": "ship",
    "text": "Ship",
    "position": { "x": 520, "y": 0 }
  },
  {
    "op": "connect",
    "id": "review-ship",
    "source": "review",
    "target": "ship",
    "text": "ready"
  }
]
```

Apply the patch:

```powershell
project-graph patch .\input.prg .\ops.json -o .\output.prg --json
```

For machine-readable operation documentation:

```powershell
project-graph schema ops
project-graph schema ops -o .\project-graph-ops.schema.json
```

## Live GUI Editing

Start the app with live mode enabled. The GUI writes a local session registry, and the CLI discovers it automatically.

```powershell
project-graph live list-sessions
project-graph live list-documents --json
project-graph live export --format pgjson -o .\current.pg.json
project-graph live patch .\ops.json --json
```

`live patch` mutates the open GUI document in memory and saves by default. Use `--no-save` only when you explicitly want a transient GUI-side change.

Manual connection is also supported:

```powershell
project-graph live patch .\ops.json --port 37821 --token <token> --json
```
