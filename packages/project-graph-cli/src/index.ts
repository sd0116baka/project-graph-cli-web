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
  live      Send commands to a GUI instance started with --live.
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

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
  const parsed = JSON.parse(content) as unknown;
  assertValidProjectGraphPatchPayload(parsed);
  if (Array.isArray(parsed)) {
    return { ops: parsed as ProjectGraphPatch["ops"] };
  }
  if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as ProjectGraphPatch).ops)) {
    return parsed as ProjectGraphPatch;
  }
  throw new Error("Patch file must be an operation array or an object with an ops array.");
}

async function writeTextOrStdout(content: string, output: string | undefined): Promise<void> {
  if (output) {
    await writeFile(output, content, "utf8");
  } else {
    process.stdout.write(content);
  }
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
