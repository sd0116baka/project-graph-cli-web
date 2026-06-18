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
      sendUnauthorized(res);
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
    sendJson(res, Number.isInteger(statusCode) ? statusCode : 500, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`Project Graph web server listening on http://${host}:${port}`);
  console.log(`Data directory: ${dataDir}`);
  if (staticDir) console.log(`Static directory: ${staticDir}`);
  if (authPassword) console.log(`Authentication: Basic user ${authUser}`);
});

async function handleApi(req, res, requestUrl) {
  const segments = requestUrl.pathname.split("/").filter(Boolean);
  const clientId = getClientId(req);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
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
      sendJson(res, 201, { project });
      return;
    }
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
      sendJson(res, 200, { project });
      return;
    }

    if (segments.length === 3 && req.method === "DELETE") {
      const lock = await getActiveLock(id);
      if (lock && lock.clientId !== clientId) {
        sendJson(res, 423, { error: "Project is locked by another client", lock });
        return;
      }
      await removeProject(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (segments.length === 4 && segments[3] === "blob") {
      if (req.method === "GET" || req.method === "HEAD") {
        await sendProjectBlob(res, id, req.method === "HEAD");
        return;
      }
      if (req.method === "PUT") {
        const lock = await getActiveLock(id);
        if (lock && lock.clientId !== clientId) {
          sendJson(res, 423, { error: "Project is locked by another client", lock });
          return;
        }
        const content = await readBinary(req);
        const currentEtag = await getProjectEtag(id);
        const ifMatch = req.headers["if-match"];
        if (ifMatch && currentEtag && !etagMatches(ifMatch, currentEtag)) {
          sendJson(res, 412, { error: "Project revision does not match", currentEtag });
          return;
        }
        const etag = await writeProjectBlob(id, content);
        res.setHeader("ETag", etag);
        sendJson(res, 200, { ok: true, etag });
        return;
      }
    }

    if (segments.length === 4 && segments[3] === "lock" && req.method === "POST") {
      const body = await readJson(req);
      const lock = await lockProject(id, body?.clientId ?? clientId, body?.ttlSeconds, body?.clientName ?? clientId);
      sendJson(res, 200, { lock });
      return;
    }

    if (segments.length === 4 && segments[3] === "unlock" && req.method === "POST") {
      await unlockProject(id, clientId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (segments.length === 4 && segments[3] === "history" && req.method === "GET") {
      sendJson(res, 200, { history: await listProjectHistory(id) });
      return;
    }

    if (segments.length === 5 && segments[3] === "restore" && req.method === "POST") {
      const revision = normalizeRevisionName(segments[4]);
      const lock = await getActiveLock(id);
      if (lock && lock.clientId !== clientId) {
        sendJson(res, 423, { error: "Project is locked by another client", lock });
        return;
      }
      const etag = await restoreProjectRevision(id, revision);
      res.setHeader("ETag", etag);
      sendJson(res, 200, { ok: true, etag });
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

async function writeProjectBlob(id, content) {
  await ensureProjectMetadata(id);
  const filePath = projectFilePath(id);
  const existing = await fs.readFile(filePath).catch(() => null);
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

async function getProjectEtag(id) {
  const content = await fs.readFile(projectFilePath(id)).catch(() => null);
  return content ? etagForBuffer(content) : null;
}

async function getActiveLock(id) {
  await expireLocks();
  const locks = await loadJson(locksPath, {});
  return locks[id] ?? null;
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
  res.setHeader("Content-Length", String(stat.size));
  res.writeHead(200);
  createReadStream(filePath).pipe(res);
}

async function readJson(req) {
  const buffer = await readBinary(req, 1024 * 1024);
  if (buffer.byteLength === 0) return {};
  return JSON.parse(buffer.toString("utf8"));
}

async function readBinary(req, limit = 200 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > limit) throw new Error("Request body is too large");
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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.PG_WEB_ALLOWED_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,If-Match,X-Project-Graph-Client");
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

function sendUnauthorized(res) {
  res.setHeader("WWW-Authenticate", 'Basic realm="Project Graph Web", charset="UTF-8"');
  sendJson(res, 401, { error: "Authentication required" });
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
