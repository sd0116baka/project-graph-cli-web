#!/usr/bin/env node
import {
  PROJECT_GRAPH_OPS_SCHEMA,
  applyOperationsToArchive,
  assertValidProjectGraphPatchPayload,
  exportMarkdown,
  exportMermaid,
  exportPgJson,
  importMarkdown,
  importMermaid,
  pgJsonToArchive,
  queryArchive,
  type PgJsonDocument,
  type ProjectGraphPatch,
  type ProjectGraphQuery,
  type ProjectGraphQueryKind,
} from "@graphif/project-graph-core";
import {
  inspectPrgArchive,
  readPrgData,
  readPrgFile,
  validatePrgArchive,
  writePrgFile,
  type PrgInspection,
} from "@graphif/prg-codec";
import { readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Command =
  | "inspect"
  | "validate"
  | "export"
  | "import"
  | "patch"
  | "query"
  | "upgrade"
  | "schema"
  | "server"
  | "live"
  | "help";
type ExportFormat = "pgjson" | "markdown" | "mermaid";
type ImportFormat = "pgjson" | "markdown" | "mermaid";

interface ParsedArgs {
  command: Command;
  positionals: string[];
  format?: string;
  output?: string;
  root?: string;
  document?: string;
  baseRevision?: number;
  port?: number;
  token?: string;
  serverUrl?: string;
  serverUser?: string;
  serverPassword?: string;
  etag?: string;
  queryKind?: string;
  queryText?: string;
  queryId?: string;
  querySection?: string | null;
  queryLimit?: number;
  json: boolean;
  inPlace: boolean;
  livePatchSave: boolean;
  preserveThumbnail: boolean;
  includeUnsupported: boolean;
}

const helpText = `Project Graph CLI

Usage:
  project-graph inspect <file.prg> [--json]
  project-graph validate <file.prg> [--json]
  project-graph export <file.prg> --format pgjson|markdown|mermaid [-o output] [--root <node-id>]
  project-graph import <input.pg.json|input.md|input.mmd> --format pgjson|markdown|mermaid -o output.prg
  project-graph patch <input.prg> <ops.json> -o output.prg
  project-graph query <file.prg> [--kind all|node|section|edge|attachment|unsupported] [--text <contains>] [--id <id>] [--section <id|null>] [--limit <n>] [--json]
  project-graph schema ops [-o output.schema.json]
  project-graph upgrade <input.prg> -o output.prg [--preserve-thumbnail]
  project-graph server list [--url <url>] [--user <user> --password <password>] [--json]
  project-graph server query <project-id> [--url <url>] [--user <user> --password <password>] [--kind all|node|section|edge|attachment|unsupported] [--text <contains>] [--id <id>] [--section <id|null>] [--limit <n>] [--json]
  project-graph server patch <project-id> <ops.json> [--url <url>] [--user <user> --password <password>] [--etag <etag>] [--json]
  project-graph server export <project-id> --format pgjson|markdown|mermaid [-o output] [--root <node-id>] [--url <url>] [--user <user> --password <password>] [--json]
  project-graph server validate <project-id> [--url <url>] [--user <user> --password <password>] [--json]
  project-graph live list-sessions [--json]
  project-graph live list-documents [--json] [--port <port> --token <token>]
  project-graph live open <file.prg|file-uri> [--json] [--port <port> --token <token>]
  project-graph live inspect [--document <id>] [--json]
  project-graph live export --format pgjson|markdown|mermaid [-o output] [--root <node-id>] [--document <id>] [--json]
  project-graph live query [--document <id>] [--kind all|node|section|edge|attachment|unsupported] [--text <contains>] [--id <id>] [--section <id|null>] [--limit <n>] [--json]
  project-graph live patch <ops.json> [--document <id>] [--base-revision <n>] [--json] [--no-save]
  project-graph help

Commands:
  inspect   Print document metadata and object counts.
  validate  Check archive shape, references, duplicate UUIDs, and attachments.
  export    Export a document to pgjson, Markdown, or Mermaid.
  import    Import pgjson, Markdown, or Mermaid into a new .prg document.
  patch     Apply an operation batch and write a new .prg document.
  query     Query graph objects for agent-friendly lookup.
  schema    Print machine-readable schemas for agent-authored payloads.
  upgrade   Re-encode a .prg archive while preserving attachments and unknown entries.
  server    Send commands to a Project Graph Web backend.
  live      Send commands to a GUI instance started with --live.

Environment:
  PROJECT_GRAPH_SERVER_URL       Default Web backend URL.
  PROJECT_GRAPH_SERVER_USER      Basic auth user for Web backend requests.
  PROJECT_GRAPH_SERVER_PASSWORD  Basic auth password for Web backend requests.
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (isServerJsonRequest(argv)) {
      printJson(
        serverErrorPayload(
          new ProjectGraphServerError(
            0,
            "invalid_cli_arguments",
            error instanceof Error ? error.message : String(error),
            undefined,
          ),
        ),
      );
      return 1;
    }
    throw error;
  }

  if (args.command === "help") {
    console.log(helpText);
    return 0;
  }

  if (args.command === "inspect") {
    const file = requirePositional(args, 0, "<file.prg>");
    const archive = await readPrgFile(file);
    const inspection = inspectPrgArchive(archive);
    if (args.json) {
      printJson(inspection);
    } else {
      printInspection(inspection);
    }
    return 0;
  }

  if (args.command === "validate") {
    const file = requirePositional(args, 0, "<file.prg>");
    const archive = await readPrgFile(file);
    const report = validatePrgArchive(archive);
    if (args.json) {
      printJson(report);
    } else if (report.issues.length === 0) {
      console.log("OK");
    } else {
      for (const issue of report.issues) {
        const path = issue.path ? ` ${issue.path}` : "";
        console.log(`${issue.severity.toUpperCase()} ${issue.code}${path}: ${issue.message}`);
      }
    }
    return report.ok ? 0 : 1;
  }

  if (args.command === "export") {
    const file = requirePositional(args, 0, "<file.prg>");
    const format = requireExportFormat(args.format);
    const archive = await readPrgFile(file);
    const content =
      format === "pgjson"
        ? exportPgJson(archive)
        : format === "markdown"
          ? exportMarkdown(archive, args.root)
          : exportMermaid(archive);
    await writeTextOrStdout(content, args.output);
    return 0;
  }

  if (args.command === "import") {
    const file = requirePositional(args, 0, "<input>");
    const format = requireImportFormat(args.format ?? inferImportFormat(file));
    const output = requireOutput(args);
    const content = await readFile(file, "utf8");
    const archive =
      format === "pgjson"
        ? pgJsonToArchive(JSON.parse(content) as PgJsonDocument)
        : format === "markdown"
          ? importMarkdown(content)
          : importMermaid(content);
    await writePrgFile(output, archive, { preserveExtraEntries: true, preserveThumbnail: args.preserveThumbnail });
    return 0;
  }

  if (args.command === "patch") {
    const file = requirePositional(args, 0, "<input.prg>");
    const patchFile = requirePositional(args, 1, "<ops.json>");
    const output = args.inPlace ? file : requireOutput(args);
    const archive = await readPrgFile(file);
    const patch = parsePatch(await readFile(patchFile, "utf8"));
    const result = applyOperationsToArchive(archive, patch);
    await writePrgFile(output, result.archive, {
      preserveExtraEntries: true,
      preserveThumbnail: args.preserveThumbnail,
    });
    if (args.json) {
      printJson({ ok: true, changed: result.changed, warnings: result.warnings });
    } else {
      console.log(`changed: ${result.changed.length}`);
      for (const warning of result.warnings) {
        console.log(`WARNING ${warning}`);
      }
    }
    return 0;
  }

  if (args.command === "query") {
    const file = requirePositional(args, 0, "<file.prg>");
    const archive = await readPrgFile(file);
    const result = queryArchive(archive, buildQuery(args));
    printQueryResult(result, args.json);
    return 0;
  }

  if (args.command === "schema") {
    const subject = requirePositional(args, 0, "ops");
    if (subject !== "ops") {
      throw new Error(`Unknown schema: ${subject}. Expected ops.`);
    }
    await writeTextOrStdout(`${JSON.stringify(PROJECT_GRAPH_OPS_SCHEMA, null, 2)}\n`, args.output);
    return 0;
  }

  if (args.command === "upgrade") {
    const file = requirePositional(args, 0, "<input.prg>");
    const output = args.inPlace ? file : requireOutput(args);
    const archive = await readPrgFile(file);
    await writePrgFile(output, archive, { preserveExtraEntries: true, preserveThumbnail: args.preserveThumbnail });
    return 0;
  }

  if (args.command === "live") {
    return handleLiveCommand(args);
  }

  if (args.command === "server") {
    return handleServerCommand(args);
  }

  return 2;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let format: string | undefined;
  let output: string | undefined;
  let root: string | undefined;
  let document: string | undefined;
  let baseRevision: number | undefined;
  let port: number | undefined;
  let token: string | undefined;
  let serverUrl: string | undefined;
  let serverUser: string | undefined;
  let serverPassword: string | undefined;
  let etag: string | undefined;
  let queryKind: string | undefined;
  let queryText: string | undefined;
  let queryId: string | undefined;
  let querySection: string | null | undefined;
  let queryLimit: number | undefined;
  let json = false;
  let inPlace = false;
  let livePatchSave = true;
  let preserveThumbnail = false;
  let includeUnsupported = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--in-place") {
      inPlace = true;
    } else if (arg === "--save") {
      livePatchSave = true;
    } else if (arg === "--no-save") {
      livePatchSave = false;
    } else if (arg === "--preserve-thumbnail") {
      preserveThumbnail = true;
    } else if (arg === "--format" || arg === "-f") {
      format = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--output" || arg === "-o") {
      output = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--root") {
      root = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--document") {
      document = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--base-revision") {
      baseRevision = Number(requireFlagValue(argv, ++index, arg));
    } else if (arg === "--port") {
      port = Number(requireFlagValue(argv, ++index, arg));
    } else if (arg === "--token") {
      token = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--url") {
      serverUrl = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--user") {
      serverUser = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--password") {
      serverPassword = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--etag" || arg === "--if-match") {
      etag = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--kind" || arg === "--type") {
      queryKind = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--text") {
      queryText = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--id") {
      queryId = requireFlagValue(argv, ++index, arg);
    } else if (arg === "--section") {
      const value = requireFlagValue(argv, ++index, arg);
      querySection = value === "null" ? null : value;
    } else if (arg === "--limit") {
      queryLimit = Number(requireFlagValue(argv, ++index, arg));
    } else if (arg === "--include-unsupported") {
      includeUnsupported = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  const rawCommand = positionals.shift();

  if (!rawCommand || rawCommand === "help") {
    return {
      command: "help",
      positionals,
      format,
      output,
      root,
      document,
      baseRevision,
      port,
      token,
      serverUrl,
      serverUser,
      serverPassword,
      etag,
      queryKind,
      queryText,
      queryId,
      querySection,
      queryLimit,
      json,
      inPlace,
      livePatchSave,
      preserveThumbnail,
      includeUnsupported,
    };
  }

  if (
    rawCommand !== "inspect" &&
    rawCommand !== "validate" &&
    rawCommand !== "export" &&
    rawCommand !== "import" &&
    rawCommand !== "patch" &&
    rawCommand !== "query" &&
    rawCommand !== "upgrade" &&
    rawCommand !== "schema" &&
    rawCommand !== "server" &&
    rawCommand !== "live"
  ) {
    throw new Error(`Unknown command: ${rawCommand}`);
  }

  return {
    command: rawCommand,
    positionals,
    format,
    output,
    root,
    document,
    baseRevision,
    port,
    token,
    serverUrl,
    serverUser,
    serverPassword,
    etag,
    queryKind,
    queryText,
    queryId,
    querySection,
    queryLimit,
    json,
    inPlace,
    livePatchSave,
    preserveThumbnail,
    includeUnsupported,
  };
}

function isServerJsonRequest(argv: string[]): boolean {
  return argv[0] === "server" && argv.includes("--json");
}

function printInspection(inspection: PrgInspection): void {
  console.log(`version: ${inspection.version}`);
  console.log(`stage objects: ${inspection.stageObjectCount}`);
  console.log(`text nodes: ${inspection.textNodeCount}`);
  console.log(`sections: ${inspection.sectionCount}`);
  console.log(`edges: ${inspection.edgeCount}`);
  console.log(`tags: ${inspection.tagsCount}`);
  console.log(`attachments: ${inspection.attachmentCount}`);
  console.log(`readme: ${inspection.hasReadme ? "yes" : "no"}`);
  console.log(`thumbnail: ${inspection.hasThumbnail ? "yes" : "no"}`);
  console.log(`extra entries: ${inspection.extraEntryCount}`);
  console.log("object types:");
  for (const [type, count] of Object.entries(inspection.objectTypes).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${type}: ${count}`);
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printQueryResult(result: ReturnType<typeof queryArchive>, json: boolean): void {
  if (json) {
    printJson(result);
    return;
  }
  for (const item of result.items) {
    const id = item.id ?? "(no id)";
    const label = item.text ? ` ${item.text}` : item.path ? ` ${item.path}` : "";
    console.log(`${item.kind} ${id} ${item.type}${label}`);
  }
  console.log(`total: ${result.total}`);
}

function buildQuery(args: ParsedArgs): ProjectGraphQuery {
  const query: ProjectGraphQuery = {
    kind: requireQueryKind(args.queryKind),
    includeUnsupported: args.includeUnsupported,
  };
  if (args.queryText !== undefined) {
    query.text = args.queryText;
  }
  if (args.queryId !== undefined) {
    query.id = args.queryId;
  }
  if (args.querySection !== undefined) {
    query.section = args.querySection;
  }
  if (args.queryLimit !== undefined) {
    if (!Number.isInteger(args.queryLimit) || args.queryLimit < 1) {
      throw new Error("--limit must be a positive integer.");
    }
    query.limit = args.queryLimit;
  }
  return query;
}

function requireQueryKind(kind: string | undefined): ProjectGraphQueryKind {
  if (
    kind === undefined ||
    kind === "all" ||
    kind === "node" ||
    kind === "section" ||
    kind === "edge" ||
    kind === "attachment" ||
    kind === "unsupported"
  ) {
    return kind ?? "all";
  }
  throw new Error("Invalid --kind. Expected all, node, section, edge, attachment, or unsupported.");
}

function requireFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function requirePositional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index];
  if (!value) {
    throw new Error(`Missing ${name}.\n\n${helpText}`);
  }
  return value;
}

function requireOutput(args: ParsedArgs): string {
  if (!args.output) {
    throw new Error(`Missing -o/--output.\n\n${helpText}`);
  }
  return args.output;
}

function requireExportFormat(format: string | undefined): ExportFormat {
  if (format === "pgjson" || format === "markdown" || format === "mermaid") {
    return format;
  }
  throw new Error("Missing or invalid --format. Expected pgjson, markdown, or mermaid.");
}

function requireImportFormat(format: string | undefined): ImportFormat {
  if (format === "pgjson" || format === "markdown" || format === "mermaid") {
    return format;
  }
  throw new Error("Missing or invalid --format. Expected pgjson, markdown, or mermaid.");
}

function inferImportFormat(file: string): ImportFormat | undefined {
  const lower = file.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown";
  }
  if (lower.endsWith(".pg.json") || lower.endsWith(".pgjson")) {
    return "pgjson";
  }
  if (lower.endsWith(".mmd") || lower.endsWith(".mermaid")) {
    return "mermaid";
  }
  return undefined;
}

function parsePatch(content: string): ProjectGraphPatch {
  const parsed = JSON.parse(stripJsonBom(content)) as unknown;
  assertValidProjectGraphPatchPayload(parsed);
  if (Array.isArray(parsed)) {
    return { ops: parsed as ProjectGraphPatch["ops"] };
  }
  if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as ProjectGraphPatch).ops)) {
    return parsed as ProjectGraphPatch;
  }
  throw new Error("Patch file must be an operation array or an object with an ops array.");
}

function stripJsonBom(content: string): string {
  return content.replace(/^\uFEFF/, "");
}

async function writeTextOrStdout(content: string, output: string | undefined): Promise<void> {
  if (output) {
    await writeFile(output, content, "utf8");
  } else {
    process.stdout.write(content);
  }
}

interface ServerProject {
  id: string;
  name: string;
  updatedAt?: string;
  size?: number;
  lock?: {
    clientId: string;
    clientName?: string;
    expiresAt?: string;
  } | null;
}

async function handleServerCommand(args: ParsedArgs): Promise<number> {
  try {
    return await runServerCommand(args);
  } catch (error) {
    if (args.json) {
      printJson(serverErrorPayload(error));
      return 1;
    }
    throw error;
  }
}

async function runServerCommand(args: ParsedArgs): Promise<number> {
  const subcommand = args.positionals[0] ?? "help";
  if (subcommand === "help") {
    console.log(helpText);
    return 0;
  }

  if (subcommand === "list") {
    const response = await sendServerJsonRequest<{ projects: ServerProject[] }>("GET", "/api/projects", args);
    if (args.json) {
      printJson(response);
    } else {
      printServerProjects(response.projects);
    }
    return 0;
  }

  if (subcommand === "query") {
    const projectId = requirePositional(args, 1, "<project-id>");
    const response = await sendServerJsonRequest<{
      ok: true;
      etag: string;
      result: ReturnType<typeof queryArchive>;
    }>("GET", `/api/projects/${encodeURIComponent(projectId)}/query?${serverQueryParams(args)}`, args);
    if (args.json) {
      printJson(response);
    } else {
      printQueryResult(response.result, false);
      console.log(`etag: ${response.etag}`);
    }
    return 0;
  }

  if (subcommand === "patch") {
    const projectId = requirePositional(args, 1, "<project-id>");
    const patchFile = requirePositional(args, 2, "<ops.json>");
    const patch = parsePatch(await readFile(patchFile, "utf8"));
    const response = await sendServerJsonRequest<{
      ok: true;
      etag: string;
      changed: string[];
      warnings: string[];
    }>("POST", `/api/projects/${encodeURIComponent(projectId)}/patch`, args, patch, args.etag);
    if (args.json) {
      printJson(response);
    } else {
      console.log(`changed: ${response.changed.length}`);
      console.log(`etag: ${response.etag}`);
      for (const warning of response.warnings) {
        console.log(`WARNING ${warning}`);
      }
    }
    return 0;
  }

  if (subcommand === "export") {
    const projectId = requirePositional(args, 1, "<project-id>");
    const format = requireExportFormat(args.format);
    const params = new URLSearchParams({ format });
    if (args.root !== undefined) {
      params.set("root", args.root);
    }
    const response = await sendServerJsonRequest<{
      ok: true;
      etag: string;
      format: ExportFormat;
      content: string;
    }>("GET", `/api/projects/${encodeURIComponent(projectId)}/export?${params}`, args);
    if (args.json) {
      await writeTextOrStdout(`${JSON.stringify(response, null, 2)}\n`, args.output);
    } else {
      await writeTextOrStdout(
        response.content.endsWith("\n") ? response.content : `${response.content}\n`,
        args.output,
      );
    }
    return 0;
  }

  if (subcommand === "validate") {
    const projectId = requirePositional(args, 1, "<project-id>");
    const response = await sendServerBinaryRequest(`/api/projects/${encodeURIComponent(projectId)}/blob`, args);
    let archive: Awaited<ReturnType<typeof readPrgData>>;
    try {
      archive = await readPrgData(response.content);
    } catch (error) {
      throw new ProjectGraphServerError(
        0,
        "invalid_project_blob",
        "Project Graph server returned an invalid .prg blob.",
        {
          etag: response.etag,
          parseError: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const report = validatePrgArchive(archive);
    if (args.json) {
      printJson({ ...report, etag: response.etag });
    } else if (report.issues.length === 0) {
      console.log("OK");
      if (response.etag) {
        console.log(`etag: ${response.etag}`);
      }
    } else {
      for (const issue of report.issues) {
        const path = issue.path ? ` ${issue.path}` : "";
        console.log(`${issue.severity.toUpperCase()} ${issue.code}${path}: ${issue.message}`);
      }
      if (response.etag) {
        console.log(`etag: ${response.etag}`);
      }
    }
    return report.ok ? 0 : 1;
  }

  throw new Error(`Unknown server subcommand: ${subcommand}`);
}

interface ServerRetryAdvice {
  action:
    | "authenticate"
    | "refresh_etag"
    | "wait_for_lock"
    | "fix_request"
    | "check_target"
    | "retry_later"
    | "inspect_error";
  retryable: boolean;
}

class ProjectGraphServerError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = "ProjectGraphServerError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function serverErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ProjectGraphServerError) {
    const payload: Record<string, unknown> = {
      ok: false,
      status: error.status,
      code: error.code,
      error: error.message,
      retry: serverRetryAdvice(error.status, error.code),
    };
    if (error.details !== undefined) {
      payload.details = error.details;
    }
    return payload;
  }

  return {
    ok: false,
    code: "cli_error",
    error: error instanceof Error ? error.message : String(error),
    retry: serverRetryAdvice(0, "cli_error"),
  };
}

function serverRetryAdvice(status: number, code: string): ServerRetryAdvice {
  if (status === 401 || code === "authentication_required") {
    return { action: "authenticate", retryable: false };
  }
  if (status === 412 || code === "etag_mismatch") {
    return { action: "refresh_etag", retryable: true };
  }
  if (status === 423 || code === "project_locked") {
    return { action: "wait_for_lock", retryable: true };
  }
  if (code === "server_unreachable") {
    return { action: "retry_later", retryable: true };
  }
  if (code === "invalid_server_response" || code === "invalid_project_blob") {
    return { action: "inspect_error", retryable: false };
  }
  if (status === 400 || code.startsWith("invalid_") || code === "base_revision_not_supported" || code === "cli_error") {
    return { action: "fix_request", retryable: false };
  }
  if (status === 404 || code === "not_found" || code === "project_file_not_found") {
    return { action: "check_target", retryable: false };
  }
  if (status >= 500) {
    return { action: "retry_later", retryable: true };
  }
  return { action: "inspect_error", retryable: false };
}

function printServerProjects(projects: ServerProject[]): void {
  for (const project of projects) {
    const lock = project.lock ? ` locked-by=${project.lock.clientName || project.lock.clientId}` : "";
    const size = typeof project.size === "number" ? ` size=${project.size}` : "";
    const updatedAt = project.updatedAt ? ` updated=${project.updatedAt}` : "";
    console.log(`${project.id} ${project.name}${size}${updatedAt}${lock}`);
  }
  console.log(`total: ${projects.length}`);
}

function serverQueryParams(args: ParsedArgs): URLSearchParams {
  const query = buildQuery(args);
  const params = new URLSearchParams();
  params.set("kind", query.kind ?? "all");
  if (query.text !== undefined) {
    params.set("text", query.text);
  }
  if (query.id !== undefined) {
    params.set("id", query.id);
  }
  if (query.section !== undefined) {
    params.set("section", query.section ?? "null");
  }
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.includeUnsupported) {
    params.set("includeUnsupported", "true");
  }
  return params;
}

async function sendServerJsonRequest<T>(
  method: string,
  pathAndQuery: string,
  args: ParsedArgs,
  body?: unknown,
  ifMatch?: string,
): Promise<T> {
  const url = new URL(pathAndQuery, `${serverBaseUrl(args)}/`);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Project-Graph-Client": "project-graph-cli",
    ...serverAuthHeaders(args),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (ifMatch !== undefined) {
    headers["If-Match"] = ifMatch;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw serverTransportError(url, error);
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new ProjectGraphServerError(
      response.status,
      "invalid_server_response",
      "Project Graph server returned invalid JSON.",
      {
        body: text.slice(0, 1024),
        parseError: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (!response.ok) {
    const record = asRecord(data);
    const code = typeof record.code === "string" ? record.code : "server_error";
    const message = typeof record.error === "string" ? record.error : response.statusText;
    throw new ProjectGraphServerError(response.status, code, message, record.details);
  }
  return data as T;
}

async function sendServerBinaryRequest(
  pathAndQuery: string,
  args: ParsedArgs,
): Promise<{ content: Buffer; etag?: string }> {
  const url = new URL(pathAndQuery, `${serverBaseUrl(args)}/`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.project-graph,application/json",
        "X-Project-Graph-Client": "project-graph-cli",
        ...serverAuthHeaders(args),
      },
    });
  } catch (error) {
    throw serverTransportError(url, error);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const text = await response.text();
    let data: unknown;
    try {
      data = text && contentType.includes("application/json") ? JSON.parse(text) : {};
    } catch (error) {
      throw new ProjectGraphServerError(
        response.status,
        "invalid_server_response",
        "Project Graph server returned invalid JSON.",
        {
          body: text.slice(0, 1024),
          parseError: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const record = asRecord(data);
    const code = typeof record.code === "string" ? record.code : "server_error";
    const message = typeof record.error === "string" ? record.error : response.statusText;
    throw new ProjectGraphServerError(response.status, code, message, record.details);
  }
  return {
    content: Buffer.from(await response.arrayBuffer()),
    etag: response.headers.get("etag") ?? undefined,
  };
}

function serverTransportError(url: URL, error: unknown): ProjectGraphServerError {
  return new ProjectGraphServerError(0, "server_unreachable", "Project Graph server request failed.", {
    url: url.toString(),
    cause: error instanceof Error ? error.message : String(error),
  });
}

function serverBaseUrl(args: ParsedArgs): string {
  const value = args.serverUrl ?? process.env.PROJECT_GRAPH_SERVER_URL ?? "http://127.0.0.1:37820";
  const parsed = new URL(value);
  return parsed.toString().replace(/\/+$/, "");
}

function serverAuthHeaders(args: ParsedArgs): Record<string, string> {
  const user = args.serverUser ?? process.env.PROJECT_GRAPH_SERVER_USER;
  const password = args.serverPassword ?? process.env.PROJECT_GRAPH_SERVER_PASSWORD;
  if (!user && !password) {
    return {};
  }
  if (!user || !password) {
    throw new Error("Server authentication requires both user and password.");
  }
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`,
  };
}

interface LiveSession {
  id: string;
  port: number;
  token: string;
  pid: number;
  registryPath: string;
}

interface LiveResponse {
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function handleLiveCommand(args: ParsedArgs): Promise<number> {
  const subcommand = args.positionals[0] ?? "help";
  if (subcommand === "help") {
    console.log(helpText);
    return 0;
  }

  if (subcommand === "list-sessions") {
    const session = await readLiveSession(false, args);
    if (args.json) {
      printJson(session ? [session] : []);
    } else if (session) {
      console.log(`${session.id} 127.0.0.1:${session.port} pid=${session.pid}`);
      console.log(`registry: ${session.registryPath}`);
    } else {
      console.log("No live Project Graph session registry found.");
    }
    return 0;
  }

  if (subcommand === "list-documents") {
    const response = await sendLiveRequest("list_documents", {}, args);
    printLiveResult(response, args.json);
    return response.ok ? 0 : 1;
  }

  if (subcommand === "open") {
    const target = requirePositional(args, 1, "<file.prg|file-uri>");
    const response = await sendLiveRequest("open_document", { uri: normalizeLiveDocumentUri(target) }, args);
    printLiveResult(response, args.json);
    return response.ok ? 0 : 1;
  }

  if (subcommand === "inspect") {
    const response = await sendLiveRequest("inspect", { document: args.document }, args);
    printLiveResult(response, args.json);
    return response.ok ? 0 : 1;
  }

  if (subcommand === "query") {
    const response = await sendLiveRequest("query", { document: args.document, ...buildQuery(args) }, args);
    if (response.ok) {
      printQueryResult(response.result as ReturnType<typeof queryArchive>, args.json);
    } else {
      printLiveResult(response, args.json);
    }
    return response.ok ? 0 : 1;
  }

  if (subcommand === "export") {
    const format = requireExportFormat(args.format);
    const response = await sendLiveRequest("export", { format, root: args.root, document: args.document }, args);
    if (!response.ok) {
      console.error(response.error ?? "Live export failed.");
      return 1;
    }
    if (args.json) {
      await writeTextOrStdout(`${JSON.stringify(response.result ?? null, null, 2)}\n`, args.output);
      return 0;
    }
    const content = getLiveExportContent(response.result);
    await writeTextOrStdout(content.endsWith("\n") ? content : `${content}\n`, args.output);
    return 0;
  }

  if (subcommand === "patch") {
    const patchFile = args.positionals[1];
    if (!patchFile) {
      throw new Error(`Missing <ops.json>.\n\n${helpText}`);
    }
    const patch = withCliBaseRevision(parsePatch(await readFile(patchFile, "utf8")), args.baseRevision);
    const response = await sendLiveRequest(
      "patch",
      { ...patch, document: args.document, save: args.livePatchSave },
      args,
    );
    printLiveResult(response, args.json);
    return response.ok ? 0 : 1;
  }

  throw new Error(`Unknown live subcommand: ${subcommand}`);
}

function getLiveExportContent(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  const record = asRecord(result);
  if (typeof record.content === "string") {
    return record.content;
  }
  return JSON.stringify(result, null, 2);
}

function normalizeLiveDocumentUri(target: string): string {
  if (looksLikeUri(target)) {
    return target;
  }
  return pathToFileURL(resolve(target)).toString();
}

function looksLikeUri(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
}

function withCliBaseRevision(patch: ProjectGraphPatch, baseRevision: number | undefined): ProjectGraphPatch {
  if (baseRevision === undefined) {
    return patch;
  }
  if (!Number.isInteger(baseRevision)) {
    throw new Error("--base-revision must be an integer.");
  }
  if (patch.baseRevision !== undefined && patch.baseRevision !== baseRevision) {
    throw new Error(`Patch baseRevision ${patch.baseRevision} does not match --base-revision ${baseRevision}.`);
  }
  return { ...patch, baseRevision };
}

function printLiveResult(response: LiveResponse, json: boolean): void {
  if (json) {
    printJson(response.ok ? (response.result ?? null) : { ok: false, error: response.error ?? "Live command failed." });
    return;
  }
  if (!response.ok) {
    console.error(response.error ?? "Live command failed.");
    return;
  }
  if (typeof response.result === "string") {
    console.log(response.result);
  } else {
    printJson(response.result);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function sendLiveRequest(method: string, params: unknown, args: ParsedArgs): Promise<LiveResponse> {
  const session = await readLiveSession(true, args);
  const request = {
    id: `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    token: args.token ?? session.token,
    method,
    params,
  };

  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host: "127.0.0.1", port: args.port ?? session.port }, () => {
      socket.end(JSON.stringify(request));
    });
    let response = "";
    socket.setTimeout(35_000);
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => {
      try {
        resolvePromise(JSON.parse(response) as LiveResponse);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("timeout", () => {
      socket.destroy(new Error("Live request timed out."));
    });
    socket.on("error", reject);
  });
}

async function readLiveSession(required: true, args: ParsedArgs): Promise<LiveSession>;
async function readLiveSession(required: false, args: ParsedArgs): Promise<LiveSession | undefined>;
async function readLiveSession(required: boolean, args: ParsedArgs): Promise<LiveSession | undefined> {
  if (args.port && args.token) {
    return {
      id: "manual",
      port: args.port,
      token: args.token,
      pid: 0,
      registryPath: liveRegistryPath(),
    };
  }

  try {
    const content = await readFile(liveRegistryPath(), "utf8");
    const session = JSON.parse(content) as LiveSession;
    return session;
  } catch (error) {
    if (required) {
      throw new Error(
        `No live session found. Start the GUI with --live, or pass --port and --token. ${String(error)}`,
        { cause: error },
      );
    }
    return undefined;
  }
}

function liveRegistryPath(): string {
  return join(tmpdir(), "project-graph-live-session.json");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
