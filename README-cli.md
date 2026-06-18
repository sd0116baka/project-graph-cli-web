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

## Web Backend Editing

`server` commands target a Project Graph Web backend. By default the CLI connects to `http://127.0.0.1:37820`.

Discover available backend and compatibility live targets:

```powershell
project-graph target list --json
project-graph daemon start --skip-build --json
project-graph daemon health --json
project-graph daemon status --json
project-graph daemon version --json
project-graph daemon stop --json
```

The Web startup scripts write a local backend registry so agents do not have to guess the active port. To override the registry location for automation or tests, set:

```powershell
$env:PROJECT_GRAPH_BACKEND_REGISTRY = "C:\path\to\project-graph-backends.json"
```

```powershell
project-graph server list --json
project-graph server import .\outline.md --name "Shared graph" --json
project-graph server query <project-id> --kind node --text Review --json
project-graph server patch <project-id> .\ops.json --etag <revision-token-from-query> --json
project-graph server validate <project-id> --json
project-graph server export <project-id> --format markdown -o .\current.md
```

For authenticated Web servers, pass credentials explicitly:

```powershell
project-graph server list --url http://10.0.0.5:37820 --user pg --password <password> --json
```

Agent runners can also use environment variables instead of command-line credentials:

```powershell
$env:PROJECT_GRAPH_SERVER_URL = "http://10.0.0.5:37820"
$env:PROJECT_GRAPH_SERVER_USER = "pg"
$env:PROJECT_GRAPH_SERVER_PASSWORD = "<password>"
```

Web backend responses include both the existing `etag` and the backend-first `revisionToken` alias. Patches accept `--etag` / `--if-match` for compatibility; agents should treat that value as the project `revisionToken`. Numeric `baseRevision` is reserved for live GUI editing.

### Agent Operation Schema

Agents should fetch the patch operation schema before generating write payloads:

```powershell
project-graph schema ops -o .\project-graph-ops.schema.json
```

`project-graph server patch` accepts the same operation array or `{ "ops": [...] }` object as offline `project-graph patch`. A minimal Web patch payload looks like:

```json
[
  {
    "op": "rename_node",
    "id": "review",
    "text": "Review"
  }
]
```

### Recommended Agent Flow

Use `--json` for every agent-facing command. The stable loop is:

```powershell
project-graph server list --json
project-graph server query <project-id> --kind node --text Review --json
project-graph server patch <project-id> .\ops.json --etag <revision-token-from-query> --json
project-graph server validate <project-id> --json
project-graph server export <project-id> --format markdown --json
```

The `query`, `patch`, `validate`, and `export` responses include `etag` and `revisionToken` when the server has a project revision. Pass the latest token to `server patch --etag` to avoid overwriting another browser or agent. If validation is not needed for the workflow, export the project after patching and inspect the returned `content`.

### Web API Equivalents

The CLI is the preferred agent entry point, but the Web backend exposes JSON endpoints for direct callers:

```http
GET /api/projects
GET /api/projects/<project-id>/query?kind=node&text=Review
POST /api/projects/<project-id>/patch
GET /api/projects/<project-id>/export?format=markdown
GET /api/projects/<project-id>/blob
```

Authenticated servers use Basic auth with the same user and password accepted by `--user` and `--password`. Patch requests should include the latest revision:

```http
If-Match: "<etag-from-query-or-export>"
Content-Type: application/json
```

The patch body is the operation array or `{ "ops": [...] }` object described by `project-graph schema ops`.

### JSON Error Contract

When `project-graph server ... --json` fails, stdout remains machine-readable and the process exits non-zero:

```json
{
  "ok": false,
  "status": 412,
  "code": "etag_mismatch",
  "error": "Project revision does not match",
  "details": {
    "currentEtag": "\"new-etag\""
  },
  "retry": {
    "action": "refresh_etag",
    "retryable": true
  }
}
```

`status` is the HTTP status when the backend responded. It is `0` for local CLI argument errors, unreachable backend connections, or invalid project blobs returned by the backend.

Retry actions are intentionally small:

- `authenticate`: fix credentials, then retry.
- `refresh_etag`: run `server query` or `server export` again, rebuild the patch if needed, then retry with the new ETag.
- `wait_for_lock`: another client owns the project lock; wait, ask the user, or retry after the lock expires.
- `fix_request`: patch/query/options are invalid; fix the payload before retrying.
- `check_target`: project id or file is missing.
- `retry_later`: transient server-side failure or backend connection failure.
- `inspect_error`: unexpected response or invalid project blob; inspect `status`, `code`, and `details`.

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
