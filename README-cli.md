# Project Graph CLI

The CLI is the agent-facing entry point for Project Graph documents. It supports two editing paths:

- Offline file transforms: read a `.prg`, apply a patch, and write a new `.prg`.
- Live GUI bridge: connect to a running GUI started with `--live`, mutate the in-memory stage, and save by default.

## Build

```powershell
pnpm nx build @graphif/project-graph-cli
```

This uses the Nx target graph and builds workspace dependencies first. If you run the package script directly, build `@graphif/prg-codec` and `@graphif/project-graph-core` first.

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

## Query

Use `query` to locate objects before authoring a patch.

```powershell
project-graph query .\graph.prg --kind node --text Review --json
project-graph query .\graph.prg --kind section --section null --json
project-graph query .\graph.prg --kind edge --id review-ship --json
```

Kinds are `all`, `node`, `section`, `edge`, `attachment`, and `unsupported`.

## Patch Files

`project-graph patch` accepts either an array of operations or an object with an `ops` array. Patch payloads are validated before they are applied.

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

Supported operations include text nodes, section create/edit/collapse/membership, image and SVG attachment nodes, line edge creation/style, color changes, deletes, Markdown/Mermaid imports, bulk moves, and grid layout. Use the schema command for exact payload shapes.

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
project-graph live open .\other.prg --json
project-graph live export --format pgjson --document <id-from-list-documents> -o .\current.pg.json
project-graph live query --document <id-from-list-documents> --kind node --text Review --json
project-graph live patch .\ops.json --document <id-from-list-documents> --base-revision 3 --json
```

`live open` asks the running GUI to open a local `.prg` file directly. It does not use the operating system file picker, so agents can open additional documents without GUI automation.

`list-documents --json` returns each open document's `id` and `revision`. If more than one Project Graph document is open, `live inspect`, `live export`, and `live patch` require `--document <id>`. Copy the `id` value from `list-documents`; on Windows, normalized file URIs may not be byte-for-byte identical to a hand-written `file:///D:/...` URI.

`live patch` mutates the selected GUI document in memory and saves by default. When `baseRevision` is present, the GUI rejects the patch if the document has changed since that revision. Use `--no-save` only when you explicitly want a transient GUI-side change.

Manual connection is also supported:

```powershell
project-graph live patch .\ops.json --document file:///D:/graph.prg --port 37821 --token <token> --json
```

## Smoke Test

On Windows, after building `app\src-tauri\target\debug\project-graph.exe`, run:

```powershell
pnpm run live:smoke
```

The smoke test starts the Vite frontend and debug GUI, opens two documents through the live bridge, checks document disambiguation, patches with autosave, compares live and disk exports, validates the saved `.prg`, and verifies corrupt files fail fast.
