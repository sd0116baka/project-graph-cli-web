import {
  applyOperationsToArchive,
  exportMarkdown,
  exportMermaid,
  exportPgJson,
  importMarkdown,
  importMermaid,
  pgJsonToArchive,
  queryArchive,
  validateProjectGraphPatchPayload,
} from "@graphif/project-graph-core";
import { readPrgData, validatePrgArchive, writePrgData } from "@graphif/prg-codec";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.PG_WEB_DATA_DIR ?? path.join(__dirname, "..", "data"));
const projectsDir = path.join(dataDir, "projects");
const backupsDir = path.join(dataDir, "backups");
const metadataPath = path.join(dataDir, "projects.json");
const locksPath = path.join(dataDir, "locks.json");
const staticDir = process.env.PG_WEB_STATIC_DIR ? path.resolve(process.env.PG_WEB_STATIC_DIR) : "";
const port = Number(process.env.PORT ?? process.env.PG_WEB_PORT ?? 37820);
const host = process.env.HOST ?? process.env.PG_WEB_HOST ?? "0.0.0.0";
const authUser = process.env.PG_WEB_AUTH_USER ?? "pg";
const authPassword = process.env.PG_WEB_AUTH_PASSWORD ?? "";
const projectMutationQueues = new Map();
const eventClients = new Set();
let eventSeq = 0;
const apiVersion = "0.1";

await ensureLayout();

const server = http.createServer(async (req, res) => {
  try {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (authPassword && requestUrl.pathname !== "/api/health" && !isAuthorized(req)) {
      sendUnauthorized(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, requestUrl);
      return;
    }

    if (staticDir) {
      await serveStatic(res, requestUrl.pathname);
      return;
    }

    sendJson(res, 200, {
      name: "Project Graph Web Server",
      api: "/api/health",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = Number(error?.statusCode ?? 500);
    sendError(
      res,
      Number.isInteger(statusCode) ? statusCode : 500,
      error?.code ?? "internal_error",
      message,
      error?.details,
    );
  }
});

server.listen(port, host, () => {
  console.log(`Project Graph web server listening on http://${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
  if (staticDir) console.log(`Static directory: ${staticDir}`);
  if (authPassword) console.log(`Authentication: Basic user ${authUser}`);
});

function isLoopbackHost(value) {
  const normalized = String(value).replace(/^\[/, "").replace(/\]$/, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

async function handleApi(req, res, requestUrl) {
  const segments = requestUrl.pathname.split("/").filter(Boolean);
  const clientId = getClientId(req);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/server-info") {
    sendJson(res, 200, {
      ok: true,
      name: "Project Graph Backend",
      apiVersion,
      host,
      port,
      dataDirName: path.basename(dataDir),
      staticDirName: staticDir ? path.basename(staticDir) : null,
      customDataDir: Boolean(process.env.PG_WEB_DATA_DIR),
      staticEnabled: Boolean(staticDir),
      authEnabled: Boolean(authPassword),
      authMode: authPassword ? "basic" : "none",
      lanMode: !isLoopbackHost(host),
      allowedOrigin: process.env.PG_WEB_ALLOWED_ORIGIN ?? "*",
      eventClients: eventClients.size,
      capabilities: {
        projects: true,
        blobs: true,
        query: true,
        patch: true,
        export: true,
        validate: true,
        import: true,
        history: true,
        restore: true,
        locks: true,
        events: true,
      },
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/events") {
    sendEventStream(req, res);
    return;
  }

  if (segments.length === 2 && segments[1] === "projects") {
    if (req.method === "GET") {
      await expireLocks();
      sendJson(res, 200, { projects: await listProjects() });
      return;
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const project = await createProject(body?.name);
      publishEvent("project_created", { projectId: project.id, project });
      sendJson(res, 201, { project });
      return;
    }
  }

  if (segments.length === 3 && segments[1] === "projects" && segments[2] === "import" && req.method === "POST") {
    const body = await readJson(req);
    const project = await importProject(body);
    publishEvent("project_imported", {
      projectId: project.id,
      project,
      revisionToken: project.revisionToken,
    });
    sendJson(res, 201, { ok: true, project });
    return;
  }

  if (segments.length >= 3 && segments[1] === "projects") {
    const id = normalizeProjectId(segments[2]);

    if (segments.length === 3 && req.method === "PATCH") {
      const lock = await getActiveLock(id);
      if (lock && lock.clientId !== clientId) {
        sendJson(res, 423, { error: "Project is locked by another client", lock });
        return;
      }
      const body = await readJson(req);
      const project = await renameProject(id, body?.name);
      publishEvent("project_renamed", { projectId: id, project });
      sendJson(res, 200, { project });
      return;
    }

    if (segments.length === 3 && req.method === "DELETE") {
      await runProjectMutation(id, async () => {
        const lock = await getActiveLock(id);
        if (lock && lock.clientId !== clientId) {
          throw createHttpError("Project is locked by another client", 423, "project_locked", { lock });
        }
        await removeProject(id);
      });
      publishEvent("project_deleted", { projectId: id });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (segments.length === 4 && segments[3] === "blob") {
      if (req.method === "GET" || req.method === "HEAD") {
        await sendProjectBlob(res, id, req.method === "HEAD");
        return;
      }
      if (req.method === "PUT") {
        const content = await readBinary(req);
        const ifMatch = req.headers["if-match"];
        const etag = await runProjectMutation(id, async () => {
          await assertProjectWriteNotLocked(id, clientId, ifMatch);
          return writeProjectBlob(id, content, { expectedEtag: ifMatch });
        });
        res.setHeader("ETag", etag);
        publishEvent("project_updated", { projectId: id, reason: "blob", revisionToken: etag });
        publishEvent("history_changed", { projectId: id });
        sendJson(res, 200, { ok: true, etag, revisionToken: etag });
        return;
      }
    }

    if (segments.length === 4 && segments[3] === "lock" && req.method === "POST") {
      const body = await readJson(req);
      const lock = await lockProject(id, body?.clientId ?? clientId, body?.ttlSeconds, body?.clientName ?? clientId);
      publishEvent("lock_changed", { projectId: id, lock });
      sendJson(res, 200, { lock });
      return;
    }

    if (segments.length === 4 && segments[3] === "unlock" && req.method === "POST") {
      await unlockProject(id, clientId);
      publishEvent("lock_changed", { projectId: id, lock: null });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (segments.length === 4 && segments[3] === "history" && req.method === "GET") {
      sendJson(res, 200, { history: await listProjectHistory(id) });
      return;
    }

    if (segments.length === 4 && segments[3] === "query" && (req.method === "GET" || req.method === "POST")) {
      const query =
        req.method === "POST"
          ? normalizeGraphQuery(await readJson(req))
          : graphQueryFromSearchParams(requestUrl.searchParams);
      const { archive, etag } = await readProjectArchive(id);
      res.setHeader("ETag", etag);
      sendJson(res, 200, { ok: true, etag, revisionToken: etag, result: queryArchive(archive, query) });
      return;
    }

    if (segments.length === 4 && segments[3] === "export" && req.method === "GET") {
      const format = normalizeExportFormat(requestUrl.searchParams.get("format") ?? "pgjson");
      const root = requestUrl.searchParams.get("root") ?? undefined;
      const { archive, etag } = await readProjectArchive(id);
      const content =
        format === "pgjson"
          ? exportPgJson(archive)
          : format === "markdown"
            ? exportMarkdown(archive, root)
            : exportMermaid(archive);
      res.setHeader("ETag", etag);
      sendJson(res, 200, { ok: true, etag, revisionToken: etag, format, content });
      return;
    }

    if (segments.length === 4 && segments[3] === "validate" && req.method === "GET") {
      let archive;
      let etag;
      try {
        ({ archive, etag } = await readProjectArchive(id));
      } catch (error) {
        if (error?.statusCode === 404) throw error;
        etag = await getProjectEtag(id);
        const issue = {
          severity: "error",
          code: "invalid_project_blob",
          message: error instanceof Error ? error.message : String(error),
        };
        if (etag) res.setHeader("ETag", etag);
        sendJson(res, 200, { ok: false, issues: [issue], etag, revisionToken: etag });
        return;
      }
      const report = validatePrgArchive(archive);
      res.setHeader("ETag", etag);
      sendJson(res, 200, { ...report, etag, revisionToken: etag });
      return;
    }

    if (segments.length === 4 && segments[3] === "patch" && req.method === "POST") {
      const body = await readJson(req);
      const patch = normalizeGraphPatch(body);
      const revisionToken = graphRevisionToken(body);
      if (patch.baseRevision !== undefined) {
        sendError(
          res,
          400,
          "base_revision_not_supported",
          "Web project patches use ETags through If-Match, not baseRevision.",
        );
        return;
      }
      const patchValidation = validateProjectGraphPatchPayload(patchWithoutRevisionToken(patch));
      if (!patchValidation.ok) {
        sendError(res, 400, "invalid_patch_payload", "Invalid Project Graph patch payload", {
          issues: patchValidation.issues,
        });
        return;
      }

      const ifMatch = req.headers["if-match"] ?? req.headers["x-project-graph-revision"] ?? revisionToken;
      const response = await runProjectMutation(id, async () => {
        await assertProjectWriteNotLocked(id, clientId, ifMatch);
        const { archive, etag: currentEtag } = await readProjectArchive(id);
        if (ifMatch && !etagMatches(ifMatch, currentEtag)) {
          throw createHttpError("Project revision does not match", 412, "etag_mismatch", {
            currentEtag,
            currentRevisionToken: currentEtag,
          });
        }

        const result = applyOperationsToArchive(archive, patchWithoutRevisionToken(patch));
        const content = Buffer.from(
          await writePrgData(result.archive, { preserveExtraEntries: true, preserveThumbnail: true }),
        );
        const etag = await writeProjectBlob(id, content, { expectedEtag: ifMatch });
        return { etag, changed: result.changed, warnings: result.warnings };
      });
      const { etag, changed, warnings } = response;
      res.setHeader("ETag", etag);
      publishEvent("project_updated", { projectId: id, reason: "patch", revisionToken: etag, changed });
      publishEvent("history_changed", { projectId: id });
      sendJson(res, 200, { ok: true, etag, revisionToken: etag, changed, warnings });
      return;
    }

    if (segments.length === 5 && segments[3] === "restore" && req.method === "POST") {
      const revision = normalizeRevisionName(segments[4]);
      const etag = await runProjectMutation(id, async () => {
        const lock = await getActiveLock(id);
        if (lock && lock.clientId !== clientId) {
          throw createHttpError("Project is locked by another client", 423, "project_locked", { lock });
        }
        return restoreProjectRevision(id, revision);
      });
      res.setHeader("ETag", etag);
      publishEvent("project_updated", { projectId: id, reason: "restore", revisionToken: etag });
      publishEvent("history_changed", { projectId: id });
      sendJson(res, 200, { ok: true, etag, revisionToken: etag });
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

async function ensureLayout() {
  await fs.mkdir(projectsDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
  await ensureJson(metadataPath, {});
  await ensureJson(locksPath, {});
}

async function ensureJson(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2));
  }
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function saveJson(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.rename(tempPath, filePath);
}

async function listProjects() {
  const metadata = await loadJson(metadataPath, {});
  const locks = await loadJson(locksPath, {});
  const projects = await Promise.all(
    Object.values(metadata).map(async (project) => {
      const filePath = projectFilePath(project.id);
      const stat = await fs.stat(filePath).catch(() => null);
      return {
        ...project,
        exists: Boolean(stat),
        size: stat?.size ?? project.size ?? 0,
        updatedAt: stat?.mtime?.toISOString?.() ?? project.updatedAt,
        lock: locks[project.id] ?? null,
      };
    }),
  );
  projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return projects;
}

async function createProject(rawName) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const name = normalizeProjectName(rawName);
  const metadata = await loadJson(metadataPath, {});
  metadata[id] = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    size: 0,
  };
  await saveJson(metadataPath, metadata);
  return metadata[id];
}

async function importProject(body) {
  const format = normalizeImportFormat(body?.format ?? inferImportFormat(body?.name ?? "project.pg.json"));
  const content = typeof body?.content === "string" ? body.content : "";
  if (!content) {
    throw createHttpError("Import content is required", 400, "invalid_import_payload");
  }
  let archive;
  try {
    archive =
      format === "pgjson"
        ? pgJsonToArchive(JSON.parse(content))
        : format === "markdown"
          ? importMarkdown(content)
          : importMermaid(content);
  } catch (error) {
    throw createHttpError("Invalid import content", 400, "invalid_import_payload", {
      format,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const project = await createProject(body?.name);
  const data = Buffer.from(await writePrgData(archive, { preserveExtraEntries: true, preserveThumbnail: true }));
  const etag = await writeProjectBlob(project.id, data);
  return { ...project, size: data.byteLength, etag, revisionToken: etag };
}

async function renameProject(id, rawName) {
  const metadata = await loadJson(metadataPath, {});
  if (!metadata[id]) {
    const error = new Error("Project not found");
    error.statusCode = 404;
    throw error;
  }
  metadata[id] = {
    ...metadata[id],
    name: normalizeProjectName(rawName),
    updatedAt: new Date().toISOString(),
  };
  await saveJson(metadataPath, metadata);
  return metadata[id];
}

async function removeProject(id) {
  const metadata = await loadJson(metadataPath, {});
  delete metadata[id];
  await saveJson(metadataPath, metadata);
  const locks = await loadJson(locksPath, {});
  delete locks[id];
  await saveJson(locksPath, locks);
  await fs.rm(projectFilePath(id), { force: true });
  await fs.rm(path.join(backupsDir, id), { recursive: true, force: true });
}

async function sendProjectBlob(res, id, headOnly) {
  const filePath = projectFilePath(id);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    sendJson(res, 404, { error: "Project file not found" });
    return;
  }
  const etag = await getProjectEtag(id);
  res.setHeader("Content-Type", "application/vnd.project-graph");
  res.setHeader("Content-Length", String(stat.size));
  if (etag) res.setHeader("ETag", etag);
  res.writeHead(200);
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function readProjectArchive(id) {
  const content = await fs.readFile(projectFilePath(id)).catch((error) => {
    if (error?.code === "ENOENT") {
      const notFound = new Error("Project file not found");
      notFound.statusCode = 404;
      notFound.code = "project_file_not_found";
      throw notFound;
    }
    throw error;
  });
  return {
    archive: await readPrgData(content),
    etag: etagForBuffer(content),
  };
}

async function writeProjectBlob(id, content, options = {}) {
  await ensureProjectMetadata(id);
  const filePath = projectFilePath(id);
  const existing = await fs.readFile(filePath).catch(() => null);
  if (options.expectedEtag !== undefined) {
    const currentEtag = existing ? etagForBuffer(existing) : null;
    if (!currentEtag || !etagMatches(options.expectedEtag, currentEtag)) {
      throw createHttpError("Project revision does not match", 412, "etag_mismatch", {
        currentEtag,
        currentRevisionToken: currentEtag,
      });
    }
  }
  if (existing) {
    await writeBackup(id, existing);
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, filePath);
  await touchProjectMetadata(id, content.byteLength);
  return etagForBuffer(content);
}

async function ensureProjectMetadata(id) {
  const metadata = await loadJson(metadataPath, {});
  if (metadata[id]) return;
  const now = new Date().toISOString();
  metadata[id] = {
    id,
    name: id,
    createdAt: now,
    updatedAt: now,
    size: 0,
  };
  await saveJson(metadataPath, metadata);
}

async function touchProjectMetadata(id, size) {
  const metadata = await loadJson(metadataPath, {});
  const now = new Date().toISOString();
  metadata[id] = {
    id,
    name: metadata[id]?.name ?? id,
    createdAt: metadata[id]?.createdAt ?? now,
    updatedAt: now,
    size,
  };
  await saveJson(metadataPath, metadata);
}

async function writeBackup(id, content) {
  const dir = path.join(backupsDir, id);
  await fs.mkdir(dir, { recursive: true });
  const revision = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  await fs.writeFile(path.join(dir, `${revision}.prg`), content);
}

async function listProjectHistory(id) {
  const dir = path.join(backupsDir, id);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const history = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".prg"))
      .map(async (entry) => {
        const stat = await fs.stat(path.join(dir, entry.name));
        return {
          revision: entry.name,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      }),
  );
  history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return history;
}

async function restoreProjectRevision(id, revision) {
  await ensureProjectMetadata(id);
  const content = await fs.readFile(path.join(backupsDir, id, revision));
  return writeProjectBlob(id, content);
}

async function runProjectMutation(id, task) {
  const previous = projectMutationQueues.get(id) ?? Promise.resolve();
  let release;
  const currentSlot = new Promise((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => currentSlot);
  projectMutationQueues.set(id, current);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (projectMutationQueues.get(id) === current) {
      projectMutationQueues.delete(id);
    }
  }
}

async function getProjectEtag(id) {
  const content = await fs.readFile(projectFilePath(id)).catch(() => null);
  return content ? etagForBuffer(content) : null;
}

async function getActiveLock(id) {
  await expireLocks();
  const locks = await loadJson(locksPath, {});
  return locks[id] ?? null;
}

async function assertProjectWriteNotLocked(id, clientId, revisionGuard) {
  if (hasSpecificRevisionGuard(revisionGuard)) {
    return;
  }
  const lock = await getActiveLock(id);
  if (lock && lock.clientId !== clientId) {
    throw createHttpError("Project is locked by another client", 423, "project_locked", { lock });
  }
}

function hasSpecificRevisionGuard(value) {
  if (value === undefined || value === null) {
    return false;
  }
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .some((part) => part !== "" && part !== "*");
}

async function lockProject(id, clientId, ttlSeconds, clientName) {
  await ensureProjectMetadata(id);
  await expireLocks();
  const locks = await loadJson(locksPath, {});
  const active = locks[id];
  if (active && active.clientId !== clientId) {
    const error = new Error("Project is already locked");
    error.statusCode = 423;
    throw error;
  }
  const ttl = clampNumber(Number(ttlSeconds ?? 300), 30, 3600);
  locks[id] = {
    clientId,
    clientName: normalizeClientName(clientName),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
  await saveJson(locksPath, locks);
  return locks[id];
}

async function unlockProject(id, clientId) {
  const locks = await loadJson(locksPath, {});
  if (locks[id]?.clientId === clientId) {
    delete locks[id];
    await saveJson(locksPath, locks);
  }
}

async function expireLocks() {
  const locks = await loadJson(locksPath, {});
  const now = Date.now();
  let changed = false;
  for (const [id, lock] of Object.entries(locks)) {
    if (!lock?.expiresAt || Date.parse(lock.expiresAt) <= now) {
      delete locks[id];
      changed = true;
    }
  }
  if (changed) await saveJson(locksPath, locks);
}

async function serveStatic(res, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const requestedPath = path.resolve(staticDir, relativePath);
  if (!isPathInside(staticDir, requestedPath)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  let filePath = requestedPath;
  let stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    filePath = path.join(staticDir, "index.html");
    stat = await fs.stat(filePath).catch(() => null);
  }
  if (!stat?.isFile()) {
    sendJson(res, 404, { error: "Static file not found" });
    return;
  }
  res.setHeader("Content-Type", contentTypeFor(filePath));
  if (path.basename(filePath) === "index.html") {
    res.setHeader("Cache-Control", "no-store");
  } else if (path.relative(staticDir, filePath).startsWith(`assets${path.sep}`)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }
  res.setHeader("Content-Length", String(stat.size));
  res.writeHead(200);
  createReadStream(filePath).pipe(res);
}

function sendEventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  eventClients.add(res);
  writeSseEvent(res, "server_connected", {
    id: String(++eventSeq),
    type: "server_connected",
    createdAt: new Date().toISOString(),
    apiVersion,
    port,
    host,
  });
  const heartbeat = setInterval(() => {
    res.write(`: ${new Date().toISOString()}\n\n`);
  }, 30000);
  req.on("close", () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
}

function publishEvent(type, payload = {}) {
  if (eventClients.size === 0) return;
  const event = {
    id: String(++eventSeq),
    type,
    createdAt: new Date().toISOString(),
    ...payload,
  };
  for (const client of eventClients) {
    writeSseEvent(client, type, event);
  }
}

function writeSseEvent(res, type, event) {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req) {
  const buffer = await readBinary(req, 1024 * 1024);
  if (buffer.byteLength === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw createHttpError("Invalid JSON request body", 400, "invalid_json", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readBinary(req, limit = 200 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > limit) throw createHttpError("Request body is too large", 413, "request_body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizeProjectId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid project id");
  }
  return id;
}

function normalizeRevisionName(revision) {
  if (!/^[a-zA-Z0-9_.-]+\.prg$/.test(revision)) {
    throw new Error("Invalid revision name");
  }
  return revision;
}

function normalizeExportFormat(format) {
  if (format === "pgjson" || format === "markdown" || format === "mermaid") {
    return format;
  }
  const error = new Error("Invalid export format");
  error.statusCode = 400;
  error.code = "invalid_export_format";
  throw error;
}

function normalizeImportFormat(format) {
  if (format === "pgjson" || format === "markdown" || format === "mermaid") {
    return format;
  }
  throw createHttpError(`Unsupported import format: ${format}`, 400, "invalid_import_format");
}

function inferImportFormat(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".mmd") || lower.endsWith(".mermaid")) return "mermaid";
  return "pgjson";
}

function graphQueryFromSearchParams(searchParams) {
  const rawQuery = {};
  for (const [key, value] of searchParams.entries()) {
    if (key === "section" && value === "null") {
      rawQuery.section = null;
    } else if (key === "limit") {
      rawQuery.limit = Number(value);
    } else if (key === "includeUnsupported") {
      rawQuery.includeUnsupported = value === "true" || value === "1";
    } else {
      rawQuery[key] = value;
    }
  }
  return normalizeGraphQuery(rawQuery);
}

function normalizeGraphQuery(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const error = new Error("Query payload must be an object");
    error.statusCode = 400;
    error.code = "invalid_query";
    throw error;
  }

  const query = {};
  if (value.kind !== undefined) {
    if (
      value.kind !== "all" &&
      value.kind !== "node" &&
      value.kind !== "section" &&
      value.kind !== "edge" &&
      value.kind !== "attachment" &&
      value.kind !== "unsupported"
    ) {
      const error = new Error("Invalid query kind");
      error.statusCode = 400;
      error.code = "invalid_query_kind";
      throw error;
    }
    query.kind = value.kind;
  }
  if (value.id !== undefined) {
    if (typeof value.id !== "string") {
      const error = new Error("Query id must be a string");
      error.statusCode = 400;
      error.code = "invalid_query_id";
      throw error;
    }
    query.id = value.id;
  }
  if (value.text !== undefined) {
    if (typeof value.text !== "string") {
      const error = new Error("Query text must be a string");
      error.statusCode = 400;
      error.code = "invalid_query_text";
      throw error;
    }
    query.text = value.text;
  }
  if (value.section !== undefined) {
    if (value.section !== null && typeof value.section !== "string") {
      const error = new Error("Query section must be a string or null");
      error.statusCode = 400;
      error.code = "invalid_query_section";
      throw error;
    }
    query.section = value.section;
  }
  if (value.limit !== undefined) {
    if (!Number.isInteger(value.limit) || value.limit < 1) {
      const error = new Error("Query limit must be a positive integer");
      error.statusCode = 400;
      error.code = "invalid_query_limit";
      throw error;
    }
    query.limit = value.limit;
  }
  if (value.includeUnsupported !== undefined) {
    if (typeof value.includeUnsupported !== "boolean") {
      const error = new Error("Query includeUnsupported must be a boolean");
      error.statusCode = 400;
      error.code = "invalid_query_include_unsupported";
      throw error;
    }
    query.includeUnsupported = value.includeUnsupported;
  }
  return query;
}

function normalizeGraphPatch(value) {
  if (Array.isArray(value)) {
    return { ops: value };
  }
  if (typeof value === "object" && value !== null && Array.isArray(value.ops)) {
    return value;
  }
  const error = new Error("Patch payload must be an operation array or an object with an ops array");
  error.statusCode = 400;
  error.code = "invalid_patch";
  throw error;
}

function graphRevisionToken(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return typeof value.revisionToken === "string" ? value.revisionToken : undefined;
}

function patchWithoutRevisionToken(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !("revisionToken" in patch)) {
    return patch;
  }
  const rest = { ...patch };
  delete rest.revisionToken;
  return rest;
}

function normalizeProjectName(name) {
  const normalized = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.slice(0, 120) || "Untitled Project";
}

function normalizeClientName(name) {
  const normalized = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.slice(0, 120) || "Unknown client";
}

function projectFilePath(id) {
  return path.join(projectsDir, `${id}.prg`);
}

function getClientId(req) {
  return String(req.headers["x-project-graph-client"] ?? "anonymous");
}

function etagForBuffer(buffer) {
  return `"${createHash("sha256").update(buffer).digest("hex")}"`;
}

function etagMatches(headerValue, etag) {
  return String(headerValue)
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "*" || part === etag || part.replace(/^"|"$/g, "") === etag.replace(/^"|"$/g, ""));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function createHttpError(message, statusCode, code, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.PG_WEB_ALLOWED_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type,If-Match,X-Project-Graph-Client,X-Project-Graph-Revision",
  );
  res.setHeader("Access-Control-Expose-Headers", "ETag");
}

function isAuthorized(req) {
  const header = String(req.headers.authorization ?? "");
  if (!header.toLowerCase().startsWith("basic ")) return false;
  const encoded = header.slice("basic ".length).trim();
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return safeEquals(user, authUser) && safeEquals(password, authPassword);
}

function safeEquals(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  if (actualBuffer.byteLength !== expectedBuffer.byteLength) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendUnauthorized(req, res) {
  if (!req.headers["x-project-graph-client"]) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Project Graph Web", charset="UTF-8"');
  }
  sendError(res, 401, "authentication_required", "Authentication required");
}

function sendError(res, statusCode, code, message, details = undefined) {
  const payload = {
    ok: false,
    code,
    error: message,
  };
  if (details !== undefined) {
    payload.details = details;
  }
  sendJson(res, statusCode, payload);
}

function sendJson(res, statusCode, data) {
  if (res.headersSent) return;
  const body = Buffer.from(JSON.stringify(data));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(body.byteLength));
  res.writeHead(statusCode);
  res.end(body);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".woff")) return "font/woff";
  if (filePath.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
