import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      JSON.stringify([
        { op: "add_text_node", id: "ship", text: "Ship", position: { x: 520, y: 0 } },
        { op: "connect", id: "review-ship", source: "Review", target: "ship", text: "ready" },
      ]),
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
});
