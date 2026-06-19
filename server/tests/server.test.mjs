import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { importMarkdown } from "@graphif/project-graph-core";
import { readPrgData, writePrgData } from "@graphif/prg-codec";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs = [];
const childProcesses = [];

afterEach(async () => {
  await Promise.all(
    childProcesses.splice(0).map(async (child) => {
      if (child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }),
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("@graphif/project-graph-web-server", () => {
  it("patches a project archive without dropping thumbnail data", async () => {
    const server = await startServer();
    const info = await requestJson(server, "/api/server-info");
    const projectId = await createProject(server);
    const originalArchive = createArchiveWithThumbnail();
    const originalEtag = await putArchive(server, projectId, originalArchive);

    expect(info.response.status).toBe(200);
    expect(info.body).toMatchObject({
      ok: true,
      host: "127.0.0.1",
      port: server.port,
      authEnabled: false,
      customDataDir: true,
      capabilities: { import: true, validate: true, events: true },
    });
    expect(info.body.dataDirName).toContain("project-graph-web-server-test-");

    const patch = await requestJson(server, `/api/projects/${projectId}/patch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": originalEtag,
        "X-Project-Graph-Client": "server-test",
      },
      body: JSON.stringify([{ op: "rename_node", id: "Review", text: "Reviewed" }]),
    });

    expect(patch.response.status).toBe(200);
    expect(patch.body).toMatchObject({ ok: true, revisionToken: expect.any(String), changed: ["Review"] });

    const blob = await getBlob(server, projectId);
    const archive = await readPrgData(blob);
    expect(archive.thumbnail).toEqual(originalArchive.thumbnail);
    expect(archive.extraEntries.get("agent-note.bin")).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("imports and validates projects through the runtime API", async () => {
    const server = await startServer();
    const imported = await requestJson(server, "/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Project-Graph-Client": "server-test" },
      body: JSON.stringify({ name: "Imported Runtime", format: "markdown", content: "# Intake\n\n## Review\n" }),
    });

    expect(imported.response.status).toBe(201);
    expect(imported.body).toMatchObject({
      ok: true,
      project: {
        name: "Imported Runtime",
        etag: expect.any(String),
        revisionToken: expect.any(String),
      },
    });

    const projectId = imported.body.project.id;
    const validation = await requestJson(server, `/api/projects/${projectId}/validate`, {
      headers: { "X-Project-Graph-Client": "server-test" },
    });
    const query = await requestJson(server, `/api/projects/${projectId}/query?kind=node&text=Review`, {
      headers: { "X-Project-Graph-Client": "server-test" },
    });
    const patch = await requestJson(server, `/api/projects/${projectId}/patch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Project-Graph-Client": "server-test",
      },
      body: JSON.stringify({
        revisionToken: imported.body.project.revisionToken,
        ops: [{ op: "rename_node", id: "Review", text: "Reviewed" }],
      }),
    });

    expect(validation.response.status).toBe(200);
    expect(validation.body).toMatchObject({ ok: true, revisionToken: imported.body.project.revisionToken });
    expect(query.body).toMatchObject({
      ok: true,
      revisionToken: imported.body.project.revisionToken,
      result: { total: 1 },
    });
    expect(patch.response.status).toBe(200);
    expect(patch.body).toMatchObject({ ok: true, revisionToken: expect.any(String), changed: ["Review"] });
  });

  it("publishes project change events over SSE", async () => {
    const server = await startServer();
    const abort = new AbortController();
    const events = await fetch(urlFor(server, "/api/events"), {
      headers: { "X-Project-Graph-Client": "server-test" },
      signal: abort.signal,
    });
    const nextProjectEvent = readSseEvent(events, "project_imported");

    const imported = await requestJson(server, "/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Project-Graph-Client": "server-test" },
      body: JSON.stringify({ name: "Event Runtime", format: "markdown", content: "# Intake\n" }),
    });
    const event = await nextProjectEvent;
    abort.abort();

    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    expect(imported.response.status).toBe(201);
    expect(event).toMatchObject({
      type: "project_imported",
      projectId: imported.body.project.id,
      revisionToken: imported.body.project.revisionToken,
    });
  });

  it("returns validation reports for corrupt project blobs", async () => {
    const server = await startServer();
    const projectId = await createProject(server);
    await fetch(urlFor(server, `/api/projects/${projectId}/blob`), {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.project-graph", "X-Project-Graph-Client": "server-test" },
      body: Buffer.from("not-a-prg"),
    });

    const validation = await requestJson(server, `/api/projects/${projectId}/validate`, {
      headers: { "X-Project-Graph-Client": "server-test" },
    });

    expect(validation.response.status).toBe(200);
    expect(validation.body).toMatchObject({
      ok: false,
      etag: expect.any(String),
      revisionToken: expect.any(String),
      issues: [{ code: "invalid_project_blob" }],
    });
  });

  it("restores a valid backup after a corrupt project write", async () => {
    const server = await startServer();
    const projectId = await createProject(server);
    const originalEtag = await putArchive(server, projectId, createArchiveWithThumbnail());
    await fetch(urlFor(server, `/api/projects/${projectId}/blob`), {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.project-graph",
        "If-Match": originalEtag,
        "X-Project-Graph-Client": "server-test",
      },
      body: Buffer.from("not-a-prg"),
    });

    const corruptValidation = await requestJson(server, `/api/projects/${projectId}/validate`, {
      headers: { "X-Project-Graph-Client": "server-test" },
    });
    const history = await requestJson(server, `/api/projects/${projectId}/history`, {
      headers: { "X-Project-Graph-Client": "server-test" },
    });
    const restored = await requestJson(
      server,
      `/api/projects/${projectId}/restore/${history.body.history[0].revision}`,
      {
        method: "POST",
        headers: { "X-Project-Graph-Client": "server-test" },
      },
    );
    const restoredValidation = await requestJson(server, `/api/projects/${projectId}/validate`, {
      headers: { "X-Project-Graph-Client": "server-test" },
    });

    expect(corruptValidation.body).toMatchObject({ ok: false, issues: [{ code: "invalid_project_blob" }] });
    expect(history.body.history.length).toBeGreaterThan(0);
    expect(restored.response.status).toBe(200);
    expect(restoredValidation.body).toMatchObject({ ok: true, issues: [] });
  });

  it("rejects invalid import payloads as request errors", async () => {
    const server = await startServer();
    const invalidPgJson = await requestJson(server, "/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Project-Graph-Client": "server-test" },
      body: JSON.stringify({ name: "Invalid", format: "pgjson", content: "{not-json" }),
    });
    const invalidJson = await requestJson(server, "/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Project-Graph-Client": "server-test" },
      body: "{not-json",
    });

    expect(invalidPgJson.response.status).toBe(400);
    expect(invalidPgJson.body).toMatchObject({ ok: false, code: "invalid_import_payload" });
    expect(invalidJson.response.status).toBe(400);
    expect(invalidJson.body).toMatchObject({ ok: false, code: "invalid_json" });
  });

  it("allows revision token headers through CORS preflight", async () => {
    const server = await startServer();
    const response = await fetch(urlFor(server, "/api/projects/project-a/patch"), {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Headers": "X-Project-Graph-Revision" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("X-Project-Graph-Revision");
  });

  it("allows only one concurrent patch for a shared ETag", async () => {
    const server = await startServer();
    const projectId = await createProject(server);
    const originalEtag = await putArchive(server, projectId, createArchiveWithThumbnail());
    const headers = {
      "Content-Type": "application/json",
      "If-Match": originalEtag,
      "X-Project-Graph-Client": "server-test",
    };

    const [first, second] = await Promise.all([
      requestJson(server, `/api/projects/${projectId}/patch`, {
        method: "POST",
        headers,
        body: JSON.stringify([{ op: "rename_node", id: "Review", text: "First" }]),
      }),
      requestJson(server, `/api/projects/${projectId}/patch`, {
        method: "POST",
        headers,
        body: JSON.stringify([{ op: "add_text_node", id: "ship", text: "Ship" }]),
      }),
    ]);

    expect([first.response.status, second.response.status].sort()).toEqual([200, 412]);
    const rejected = first.response.status === 412 ? first : second;
    expect(rejected.body).toMatchObject({
      ok: false,
      code: "etag_mismatch",
    });
  });

  it("keeps server info behind authentication when auth is enabled", async () => {
    const server = await startServer({ authPassword: "secret" });

    const unauthenticated = await requestJson(server, "/api/server-info");
    const desktopClient = await requestJson(server, "/api/server-info", {
      headers: { "X-Project-Graph-Client": "server-test" },
    });
    const authenticated = await requestJson(server, "/api/server-info", {
      headers: { Authorization: "Basic cGc6c2VjcmV0" },
    });

    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.response.headers.get("www-authenticate")).toContain("Basic");
    expect(unauthenticated.body).toMatchObject({ ok: false, code: "authentication_required" });
    expect(desktopClient.response.status).toBe(401);
    expect(desktopClient.response.headers.get("www-authenticate")).toBeNull();
    expect(desktopClient.body).toMatchObject({ ok: false, code: "authentication_required" });
    expect(authenticated.response.status).toBe(200);
    expect(authenticated.body).toMatchObject({ ok: true, authEnabled: true });
  });
});

function createArchiveWithThumbnail() {
  const archive = importMarkdown("# Intake\n\n## Review\n", { prgVersion: "2.4.0" });
  archive.thumbnail = new Uint8Array([1, 2, 3]);
  archive.extraEntries.set("agent-note.bin", new Uint8Array([4, 5, 6]));
  return archive;
}

async function startServer(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "project-graph-web-server-test-"));
  tempDirs.push(dataDir);
  const port = await getFreePort();
  const output = { stdout: "", stderr: "" };
  const child = spawn(process.execPath, ["server/src/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PG_WEB_AUTH_PASSWORD: options.authPassword ?? "",
      PG_WEB_DATA_DIR: dataDir,
      PG_WEB_HOST: "127.0.0.1",
      PG_WEB_PORT: String(port),
      PG_WEB_STATIC_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    output.stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk.toString();
  });
  childProcesses.push(child);
  await waitForHealth(port, child, output);
  return { port };
}

async function createProject(server) {
  const result = await requestJson(server, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Project-Graph-Client": "server-test" },
    body: JSON.stringify({ name: "Server Test" }),
  });
  expect(result.response.status).toBe(201);
  return result.body.project.id;
}

async function putArchive(server, projectId, archive) {
  const data = await writePrgData(archive, { preserveExtraEntries: true, preserveThumbnail: true });
  const response = await fetch(urlFor(server, `/api/projects/${projectId}/blob`), {
    method: "PUT",
    headers: { "Content-Type": "application/vnd.project-graph", "X-Project-Graph-Client": "server-test" },
    body: data,
  });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({ ok: true });
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  return etag;
}

async function getBlob(server, projectId) {
  const response = await fetch(urlFor(server, `/api/projects/${projectId}/blob`), {
    headers: { "X-Project-Graph-Client": "server-test" },
  });
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

async function requestJson(server, path, init) {
  const response = await fetch(urlFor(server, path), init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : {},
  };
}

async function readSseEvent(response, expectedType) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const read = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for SSE data")), remaining)),
    ]);
    if (read.done) break;
    buffer += decoder.decode(read.value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = parseSseEvent(rawEvent);
      if (event?.type === expectedType) {
        return event;
      }
      separator = buffer.indexOf("\n\n");
    }
  }
  throw new Error(`Timed out waiting for ${expectedType} SSE event.`);
}

function parseSseEvent(rawEvent) {
  const lines = rawEvent.split("\n");
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return data ? JSON.parse(data) : undefined;
}

function urlFor(server, path) {
  return `http://127.0.0.1:${server.port}${path}`;
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  if (!address || typeof address === "string") {
    throw new Error("Cannot resolve free port.");
  }
  return address.port;
}

async function waitForHealth(port, child, output) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check passed.\n${output.stdout}\n${output.stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "no response");
  throw new Error(`Timed out waiting for server health check: ${message}\n${output.stdout}\n${output.stderr}`);
}
