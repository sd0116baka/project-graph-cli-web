import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders, type Server as HttpServer } from "node:http";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_GRAPH_OPS_SCHEMA, archiveToPgJson } from "@graphif/project-graph-core";
import { readPrgFile } from "@graphif/prg-codec";
import { main } from "../src/index";

const tempDirs: string[] = [];
const servers: Server[] = [];
const httpServers: HttpServer[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "project-graph-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let stdout = "";
  let stderr = "";

  console.log = (...args: unknown[]) => {
    stdout += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    stderr += `${args.map(String).join(" ")}\n`;
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    const code = await main(args);
    return { code, stdout, stderr };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return { code: 1, stdout, stderr };
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

async function startLiveServer(
  handler: (request: Record<string, unknown>) => unknown,
): Promise<{ port: number; requests: Array<Record<string, unknown>> }> {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((socket) => {
    let body = "";
    socket.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    socket.on("end", () => {
      const request = JSON.parse(body) as Record<string, unknown>;
      requests.push(request);
      socket.end(
        JSON.stringify({
          id: request.id,
          ok: true,
          result: handler(request),
        }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Cannot resolve fake live server address.");
  }
  return { port: address.port, requests };
}

interface HttpRequestRecord {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

async function startHttpServer(
  handler: (request: HttpRequestRecord) => { status?: number; headers?: Record<string, string>; body?: unknown },
): Promise<{ port: number; requests: HttpRequestRecord[] }> {
  const requests: HttpRequestRecord[] = [];
  const server = createHttpServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
    }
    const record: HttpRequestRecord = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body,
    };
    requests.push(record);
    const response = handler(record);
    const responseBody = Buffer.isBuffer(response.body)
      ? response.body
      : typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body ?? {});
    const headers = {
      "Content-Type": Buffer.isBuffer(response.body) ? "application/octet-stream" : "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(responseBody),
      ...response.headers,
    };
    res.writeHead(response.status ?? 200, headers);
    res.end(responseBody);
  });
  httpServers.push(server);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Cannot resolve fake HTTP server address.");
  }
  return { port: address.port, requests };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolvePromise, reject) => {
          server.close((error) => (error ? reject(error) : resolvePromise()));
        }),
    ),
  );
  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolvePromise, reject) => {
          server.close((error) => (error ? reject(error) : resolvePromise()));
        }),
    ),
  );
});

describe("@graphif/project-graph-cli", () => {
  it("imports markdown, patches the document, validates it, and exports mermaid", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    const input = join(dir, "input.prg");
    const patch = join(dir, "ops.json");
    const output = join(dir, "output.prg");
    const mermaid = join(dir, "output.mmd");

    await writeFile(markdown, "# Intake\n\n## Review\n", "utf8");
    await writeFile(
      patch,
      `\uFEFF${JSON.stringify([
        { op: "add_text_node", id: "ship", text: "Ship", position: { x: 520, y: 0 } },
        { op: "connect", id: "review-ship", source: "Review", target: "ship", text: "ready" },
      ])}`,
      "utf8",
    );

    expect((await runCli(["import", markdown, "--format", "markdown", "-o", input])).code).toBe(0);
    const patchResult = await runCli(["patch", input, patch, "-o", output, "--json"]);
    const validateResult = await runCli(["validate", output]);
    expect((await runCli(["export", output, "--format", "mermaid", "-o", mermaid])).code).toBe(0);

    expect(patchResult.code).toBe(0);
    expect(JSON.parse(patchResult.stdout)).toMatchObject({ ok: true, changed: ["ship", "review-ship"] });
    expect(validateResult).toMatchObject({ code: 0, stdout: "OK\n", stderr: "" });
    expect(await readFile(mermaid, "utf8")).toContain('id1 -- "ready" --> id2');
  });

  it("queries graph objects from a prg document", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    const input = join(dir, "input.prg");

    await writeFile(markdown, "# Intake\n\n## Review\n", "utf8");

    expect((await runCli(["import", markdown, "--format", "markdown", "-o", input])).code).toBe(0);
    const result = await runCli(["query", input, "--kind", "node", "--text", "Review", "--json"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      total: 1,
      items: [{ kind: "node", type: "text", text: "Review" }],
    });
  });

  it("rejects invalid patch files before writing output", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    const input = join(dir, "input.prg");
    const patch = join(dir, "invalid-ops.json");
    const output = join(dir, "output.prg");

    await writeFile(markdown, "# Intake\n", "utf8");
    await writeFile(patch, JSON.stringify([{ op: "add_text_node", text: 42 }]), "utf8");

    expect((await runCli(["import", markdown, "--format", "markdown", "-o", input])).code).toBe(0);
    const result = await runCli(["patch", input, patch, "-o", output]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("$.ops[0].text must be a string");
  });

  it("exports pgjson and imports it back into a prg document", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    const sourcePrg = join(dir, "source.prg");
    const pgjson = join(dir, "graph.pg.json");
    const importedPrg = join(dir, "imported.prg");

    await writeFile(markdown, "# Root\n\nintro\n\n## Child\n", "utf8");

    expect((await runCli(["import", markdown, "-o", sourcePrg])).code).toBe(0);
    expect((await runCli(["export", sourcePrg, "--format", "pgjson", "-o", pgjson])).code).toBe(0);
    expect((await runCli(["import", pgjson, "-o", importedPrg])).code).toBe(0);

    const document = archiveToPgJson(await readPrgFile(importedPrg));
    expect(document.nodes.map((node) => node.text)).toEqual(["Root", "Child"]);
    expect(document.nodes.find((node) => node.text === "Root")?.detailsMarkdown).toBe("intro");
    expect(document.edges).toHaveLength(1);
  });

  it("prints the patch operation schema", async () => {
    const dir = await createTempDir();
    const schemaFile = join(dir, "ops.schema.json");
    const stdoutResult = await runCli(["schema", "ops"]);
    const fileResult = await runCli(["schema", "ops", "-o", schemaFile]);

    expect(stdoutResult).toMatchObject({ code: 0, stderr: "" });
    expect(fileResult).toMatchObject({ code: 0, stdout: "", stderr: "" });

    const stdoutSchema = JSON.parse(stdoutResult.stdout) as typeof PROJECT_GRAPH_OPS_SCHEMA;
    const fileSchema = JSON.parse(await readFile(schemaFile, "utf8")) as typeof PROJECT_GRAPH_OPS_SCHEMA;
    expect(stdoutSchema.$id).toBe(PROJECT_GRAPH_OPS_SCHEMA.$id);
    expect(fileSchema.$id).toBe(PROJECT_GRAPH_OPS_SCHEMA.$id);
    expect(stdoutResult.stdout).toContain("add_text_node");
    expect(stdoutResult.stdout).toContain("import_mermaid");
  });

  it("sends document and base revision to live patch", async () => {
    const dir = await createTempDir();
    const patchFile = join(dir, "ops.json");
    await writeFile(patchFile, JSON.stringify([{ op: "rename_node", id: "node-a", text: "Alpha" }]), "utf8");
    const server = await startLiveServer(() => ({ changed: ["node-a"], revision: 8 }));

    const result = await runCli([
      "live",
      "patch",
      patchFile,
      "--document",
      "file:///graph.prg",
      "--base-revision",
      "7",
      "--port",
      String(server.port),
      "--token",
      "secret",
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      token: "secret",
      method: "patch",
      params: {
        document: "file:///graph.prg",
        baseRevision: 7,
        save: true,
        ops: [{ op: "rename_node", id: "node-a", text: "Alpha" }],
      },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ changed: ["node-a"], revision: 8 });
  });

  it("opens a live document by normalized file uri", async () => {
    const dir = await createTempDir();
    const projectFile = join(dir, "graph.prg");
    const server = await startLiveServer(() => ({
      opened: true,
      document: { id: pathToFileURL(resolve(projectFile)).toString(), revision: 0 },
    }));

    const result = await runCli([
      "live",
      "open",
      projectFile,
      "--port",
      String(server.port),
      "--token",
      "secret",
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      token: "secret",
      method: "open_document",
      params: {
        uri: pathToFileURL(resolve(projectFile)).toString(),
      },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ opened: true });
  });

  it("sends query params to the live bridge", async () => {
    const server = await startLiveServer(() => ({
      total: 1,
      items: [{ kind: "node", id: "node-a", type: "text", text: "Alpha" }],
    }));

    const result = await runCli([
      "live",
      "query",
      "--document",
      "file:///graph.prg",
      "--kind",
      "node",
      "--text",
      "Alpha",
      "--port",
      String(server.port),
      "--token",
      "secret",
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      token: "secret",
      method: "query",
      params: {
        document: "file:///graph.prg",
        kind: "node",
        text: "Alpha",
        includeUnsupported: false,
      },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ total: 1, items: [{ id: "node-a" }] });
  });

  it("unwraps live export content unless json output is requested", async () => {
    const dir = await createTempDir();
    const outputFile = join(dir, "current.pg.json");
    const server = await startLiveServer(() => ({
      document: { id: "file:///graph.prg" },
      revision: 3,
      format: "pgjson",
      content: '{"schemaVersion":"0.1"}\n',
    }));

    const contentResult = await runCli([
      "live",
      "export",
      "--format",
      "pgjson",
      "--document",
      "file:///graph.prg",
      "--port",
      String(server.port),
      "--token",
      "secret",
      "-o",
      outputFile,
    ]);
    const jsonResult = await runCli([
      "live",
      "export",
      "--format",
      "pgjson",
      "--document",
      "file:///graph.prg",
      "--port",
      String(server.port),
      "--token",
      "secret",
      "--json",
    ]);

    expect(contentResult).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(await readFile(outputFile, "utf8")).toBe('{"schemaVersion":"0.1"}\n');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({ revision: 3, content: '{"schemaVersion":"0.1"}\n' });
    expect(server.requests.map((request) => request.params)).toEqual([
      { format: "pgjson", document: "file:///graph.prg" },
      { format: "pgjson", document: "file:///graph.prg" },
    ]);
  });

  it("sends list, query, patch, and export requests to a Web backend", async () => {
    const dir = await createTempDir();
    const patchFile = join(dir, "ops.json");
    const outputFile = join(dir, "server-export.md");
    await writeFile(patchFile, JSON.stringify([{ op: "rename_node", id: "node-a", text: "Alpha" }]), "utf8");
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/projects") {
        return {
          body: {
            projects: [{ id: "project-a", name: "Project A", size: 128, updatedAt: "2026-06-18T00:00:00.000Z" }],
          },
        };
      }
      if (request.method === "GET" && url.pathname === "/api/projects/project-a/query") {
        expect(url.searchParams.get("kind")).toBe("node");
        expect(url.searchParams.get("text")).toBe("Alpha");
        return {
          body: {
            ok: true,
            etag: '"etag-a"',
            result: { total: 1, items: [{ kind: "node", id: "node-a", type: "text", text: "Alpha" }] },
          },
        };
      }
      if (request.method === "POST" && url.pathname === "/api/projects/project-a/patch") {
        expect(request.headers["if-match"]).toBe('"etag-a"');
        expect(JSON.parse(request.body)).toMatchObject({ ops: [{ op: "rename_node", id: "node-a" }] });
        return { body: { ok: true, etag: '"etag-b"', changed: ["node-a"], warnings: [] } };
      }
      if (request.method === "GET" && url.pathname === "/api/projects/project-a/export") {
        expect(url.searchParams.get("format")).toBe("markdown");
        return { body: { ok: true, etag: '"etag-b"', format: "markdown", content: "# Alpha\n" } };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });
    const url = `http://127.0.0.1:${server.port}`;

    const listResult = await runCli(["server", "list", "--url", url, "--user", "pg", "--password", "secret", "--json"]);
    const queryResult = await runCli([
      "server",
      "query",
      "project-a",
      "--url",
      url,
      "--user",
      "pg",
      "--password",
      "secret",
      "--kind",
      "node",
      "--text",
      "Alpha",
      "--json",
    ]);
    const patchResult = await runCli([
      "server",
      "patch",
      "project-a",
      patchFile,
      "--url",
      url,
      "--user",
      "pg",
      "--password",
      "secret",
      "--etag",
      '"etag-a"',
      "--json",
    ]);
    const exportResult = await runCli([
      "server",
      "export",
      "project-a",
      "--url",
      url,
      "--user",
      "pg",
      "--password",
      "secret",
      "--format",
      "markdown",
      "-o",
      outputFile,
    ]);
    const jsonExportResult = await runCli([
      "server",
      "export",
      "project-a",
      "--url",
      url,
      "--user",
      "pg",
      "--password",
      "secret",
      "--format",
      "markdown",
      "--json",
    ]);

    expect(listResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(listResult.stdout)).toMatchObject({ projects: [{ id: "project-a" }] });
    expect(queryResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(queryResult.stdout)).toMatchObject({ etag: '"etag-a"', result: { total: 1 } });
    expect(patchResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(patchResult.stdout)).toMatchObject({ etag: '"etag-b"', changed: ["node-a"] });
    expect(exportResult).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(await readFile(outputFile, "utf8")).toBe("# Alpha\n");
    expect(jsonExportResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(jsonExportResult.stdout)).toMatchObject({
      ok: true,
      etag: '"etag-b"',
      format: "markdown",
      content: "# Alpha\n",
    });
    expect(server.requests.every((request) => request.headers.authorization === "Basic cGc6c2VjcmV0")).toBe(true);
  });

  it("imports and validates a Web backend project as JSON", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    await writeFile(markdown, "# Intake\n\n## Review\n", "utf8");
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/projects/import") {
        expect(JSON.parse(request.body)).toMatchObject({
          name: "Imported",
          format: "markdown",
          content: "# Intake\n\n## Review\n",
        });
        return {
          status: 201,
          body: {
            ok: true,
            project: { id: "project-a", name: "Imported", etag: '"etag-import"', revisionToken: '"etag-import"' },
          },
        };
      }
      if (request.method === "GET" && url.pathname === "/api/projects/project-a/validate") {
        return {
          body: { ok: true, etag: '"etag-validate"', revisionToken: '"etag-validate"', issues: [] },
        };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });
    const url = `http://127.0.0.1:${server.port}`;

    const importResult = await runCli(["server", "import", markdown, "--url", url, "--name", "Imported", "--json"]);
    const validateResult = await runCli(["server", "validate", "project-a", "--url", url, "--json"]);

    expect(importResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(importResult.stdout)).toMatchObject({
      ok: true,
      project: { id: "project-a", revisionToken: '"etag-import"' },
    });
    expect(validateResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(validateResult.stdout)).toMatchObject({
      ok: true,
      etag: '"etag-validate"',
      revisionToken: '"etag-validate"',
      issues: [],
    });
  });

  it("uses revisionToken from Web backend patch files", async () => {
    const dir = await createTempDir();
    const patchFile = join(dir, "ops-with-token.json");
    await writeFile(
      patchFile,
      JSON.stringify({
        revisionToken: '"etag-a"',
        ops: [{ op: "rename_node", id: "node-a", text: "Alpha" }],
      }),
      "utf8",
    );
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/projects/project-a/patch") {
        expect(request.headers["if-match"]).toBe('"etag-a"');
        expect(JSON.parse(request.body)).toMatchObject({
          revisionToken: '"etag-a"',
          ops: [{ op: "rename_node", id: "node-a" }],
        });
        return { body: { ok: true, etag: '"etag-b"', revisionToken: '"etag-b"', changed: ["node-a"], warnings: [] } };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });

    const result = await runCli([
      "server",
      "patch",
      "project-a",
      patchFile,
      "--url",
      `http://127.0.0.1:${server.port}`,
      "--json",
    ]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({ revisionToken: '"etag-b"', changed: ["node-a"] });
  });

  it("waits for a Web backend and project revision", async () => {
    let validateCount = 0;
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        return { body: { ok: true } };
      }
      if (request.method === "GET" && url.pathname === "/api/projects/project-a/validate") {
        validateCount++;
        const revisionToken = validateCount === 1 ? '"etag-a"' : '"etag-b"';
        return { body: { ok: true, etag: revisionToken, revisionToken, issues: [] } };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });
    const url = `http://127.0.0.1:${server.port}`;

    const readyResult = await runCli(["server", "wait", "ready", "--url", url, "--timeout", "1000", "--json"]);
    const revisionResult = await runCli([
      "server",
      "wait",
      "project-a",
      "--url",
      url,
      "--revision",
      '"etag-a"',
      "--timeout",
      "3000",
      "--json",
    ]);

    expect(readyResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(readyResult.stdout)).toMatchObject({ ok: true, url });
    expect(revisionResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(revisionResult.stdout)).toMatchObject({
      ok: true,
      projectId: "project-a",
      revisionToken: '"etag-b"',
    });
  });

  it("discovers backend targets from the local registry", async () => {
    const dir = await createTempDir();
    const registryPath = join(dir, "project-graph-backends.json");
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        return { body: { ok: true } };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });
    const oldRegistry = process.env.PROJECT_GRAPH_BACKEND_REGISTRY;
    const oldServerUrl = process.env.PROJECT_GRAPH_SERVER_URL;
    process.env.PROJECT_GRAPH_BACKEND_REGISTRY = registryPath;
    delete process.env.PROJECT_GRAPH_SERVER_URL;
    await writeFile(
      registryPath,
      `\uFEFF${JSON.stringify({
        targets: [
          {
            id: "local-test",
            kind: "daemon",
            url: `http://127.0.0.1:${server.port}`,
            port: server.port,
            apiVersion: "0.1",
            authMode: "none",
            dataDirName: "data",
            capabilities: { projects: true, query: true, patch: true },
          },
        ],
      })}`,
      "utf8",
    );

    try {
      const result = await runCli(["target", "list", "--json"]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        targets: [
          {
            id: "local-test",
            kind: "daemon",
            url: `http://127.0.0.1:${server.port}`,
            reachable: true,
            apiVersion: "0.1",
            authMode: "none",
            dataDirName: "data",
          },
        ],
      });
    } finally {
      if (oldRegistry === undefined) {
        delete process.env.PROJECT_GRAPH_BACKEND_REGISTRY;
      } else {
        process.env.PROJECT_GRAPH_BACKEND_REGISTRY = oldRegistry;
      }
      if (oldServerUrl === undefined) {
        delete process.env.PROJECT_GRAPH_SERVER_URL;
      } else {
        process.env.PROJECT_GRAPH_SERVER_URL = oldServerUrl;
      }
    }
  });

  it("ignores malformed backend registry files", async () => {
    const dir = await createTempDir();
    const registryPath = join(dir, "project-graph-backends.json");
    const oldRegistry = process.env.PROJECT_GRAPH_BACKEND_REGISTRY;
    const oldServerUrl = process.env.PROJECT_GRAPH_SERVER_URL;
    process.env.PROJECT_GRAPH_BACKEND_REGISTRY = registryPath;
    delete process.env.PROJECT_GRAPH_SERVER_URL;
    await writeFile(registryPath, "{not-json", "utf8");

    try {
      const result = await runCli(["target", "list", "--json"]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({ targets: [] });
    } finally {
      if (oldRegistry === undefined) {
        delete process.env.PROJECT_GRAPH_BACKEND_REGISTRY;
      } else {
        process.env.PROJECT_GRAPH_BACKEND_REGISTRY = oldRegistry;
      }
      if (oldServerUrl === undefined) {
        delete process.env.PROJECT_GRAPH_SERVER_URL;
      } else {
        process.env.PROJECT_GRAPH_SERVER_URL = oldServerUrl;
      }
    }
  });

  it("classifies IPv6 loopback URLs as local daemon targets", async () => {
    const serverUrl = process.env.PROJECT_GRAPH_SERVER_URL;
    process.env.PROJECT_GRAPH_SERVER_URL = "http://[::1]:37820";
    try {
      const result = await runCli(["target", "list", "--json"]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        targets: [{ id: "local-::1-37820", kind: "daemon", url: "http://[::1]:37820" }],
      });
    } finally {
      if (serverUrl === undefined) {
        delete process.env.PROJECT_GRAPH_SERVER_URL;
      } else {
        process.env.PROJECT_GRAPH_SERVER_URL = serverUrl;
      }
    }
  });

  it("prints daemon status and version from server info", async () => {
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/server-info") {
        return {
          body: {
            ok: true,
            name: "Project Graph Backend",
            apiVersion: "0.1",
            authMode: "none",
            lanMode: true,
            dataDirName: "data",
            capabilities: { projects: true, query: true, patch: true, events: false },
          },
        };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });
    const url = `http://127.0.0.1:${server.port}`;

    const statusResult = await runCli(["daemon", "status", "--url", url, "--json"]);
    const versionResult = await runCli(["daemon", "version", "--url", url, "--json"]);

    expect(statusResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(statusResult.stdout)).toMatchObject({
      ok: true,
      url,
      apiVersion: "0.1",
      authMode: "none",
      dataDirName: "data",
    });
    expect(versionResult).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(versionResult.stdout)).toMatchObject({ ok: true, url, apiVersion: "0.1" });
  });

  it("documents daemon start stop and restart commands", async () => {
    const result = await runCli(["help"]);

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("project-graph daemon start");
    expect(result.stdout).toContain("project-graph daemon stop");
    expect(result.stdout).toContain("project-graph daemon restart");
  });

  it("prints structured JSON for Web backend CLI argument errors", async () => {
    const result = await runCli(["server", "list", "--bad", "--json"]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      status: 0,
      code: "invalid_cli_arguments",
      error: "Unknown option: --bad",
      retry: { action: "fix_request", retryable: false },
    });
  });

  it("rejects unknown Web backend subcommands before contacting the backend", async () => {
    const server = await startHttpServer(() => {
      throw new Error("unknown server subcommands should not contact the backend");
    });

    const result = await runCli(["server", "missing", "--url", `http://127.0.0.1:${server.port}`, "--json"]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(server.requests).toHaveLength(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: "invalid_cli_arguments",
      error: "Unknown server subcommand: missing",
      retry: { action: "fix_request", retryable: false },
    });
  });

  it("prints structured JSON when the Web backend is unreachable", async () => {
    const closedServer = createHttpServer();
    await new Promise<void>((resolvePromise) => {
      closedServer.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = closedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Cannot resolve temporary closed server address.");
    }
    await new Promise<void>((resolvePromise, reject) => {
      closedServer.close((error) => (error ? reject(error) : resolvePromise()));
    });

    const result = await runCli(["server", "list", "--url", `http://127.0.0.1:${address.port}`, "--json"]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      status: 0,
      code: "server_unreachable",
      retry: { action: "retry_later", retryable: true },
    });
  });

  it("returns backend validation reports with issues as JSON", async () => {
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/projects/project-a/validate") {
        return {
          body: {
            ok: false,
            etag: '"etag-invalid"',
            revisionToken: '"etag-invalid"',
            issues: [{ severity: "error", code: "invalid_archive", message: "Invalid archive" }],
          },
        };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });

    const result = await runCli([
      "server",
      "validate",
      "project-a",
      "--url",
      `http://127.0.0.1:${server.port}`,
      "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      etag: '"etag-invalid"',
      revisionToken: '"etag-invalid"',
      issues: [{ code: "invalid_archive" }],
    });
  });

  it("rejects incompatible Web backend API versions", async () => {
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/server-info") {
        return { body: { ok: true, apiVersion: "9.0" } };
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        throw new Error("project list should not be called after an API mismatch");
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });

    const result = await runCli(["server", "list", "--url", `http://127.0.0.1:${server.port}`, "--json"]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: "api_version_mismatch",
      details: { expectedApiVersion: "0.1", actualApiVersion: "9.0" },
    });
  });

  it("prints structured JSON for Web backend errors", async () => {
    const dir = await createTempDir();
    const patchFile = join(dir, "ops.json");
    await writeFile(patchFile, JSON.stringify([{ op: "rename_node", id: "node-a", text: "Alpha" }]), "utf8");
    const server = await startHttpServer((request) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/projects/project-a/patch") {
        return {
          status: 412,
          body: {
            ok: false,
            code: "etag_mismatch",
            error: "Project revision does not match",
            details: { currentEtag: '"etag-b"' },
          },
        };
      }
      return { status: 404, body: { ok: false, code: "not_found", error: "Not found" } };
    });

    const result = await runCli([
      "server",
      "patch",
      "project-a",
      patchFile,
      "--url",
      `http://127.0.0.1:${server.port}`,
      "--etag",
      '"etag-a"',
      "--json",
    ]);

    expect(result).toMatchObject({ code: 1, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      status: 412,
      code: "etag_mismatch",
      error: "Project revision does not match",
      details: { currentEtag: '"etag-b"' },
      retry: { action: "refresh_etag", retryable: true },
    });
  });
});
