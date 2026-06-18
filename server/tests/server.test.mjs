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
    expect(patch.body).toMatchObject({ ok: true, changed: ["Review"] });

    const blob = await getBlob(server, projectId);
    const archive = await readPrgData(blob);
    expect(archive.thumbnail).toEqual(originalArchive.thumbnail);
    expect(archive.extraEntries.get("agent-note.bin")).toEqual(new Uint8Array([4, 5, 6]));
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
    const authenticated = await requestJson(server, "/api/server-info", {
      headers: { Authorization: "Basic cGc6c2VjcmV0" },
    });

    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.body).toMatchObject({ ok: false, code: "authentication_required" });
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
