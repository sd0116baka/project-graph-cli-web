import { randomUUID } from "../../../utils/randomUUID";
import { isBrowserRuntime, isTauriRuntime } from "@/utils/runtime";
import { URI } from "vscode-uri";

export namespace ServerProjectManager {
  export const errorEventName = "project-graph-server-error";

  export type ServerProject = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    exists: boolean;
    size: number;
    lock?: ProjectLock | null;
  };

  export type ProjectLock = {
    clientId: string;
    clientName?: string;
    expiresAt: string;
  };

  export type ProjectHistoryEntry = {
    revision: string;
    size: number;
    createdAt: string;
  };

  export type ServerInfo = {
    ok: true;
    name?: string;
    apiVersion?: string;
    host: string;
    port: number;
    dataDirName: string;
    staticDirName: string | null;
    customDataDir: boolean;
    staticEnabled: boolean;
    authEnabled: boolean;
    authMode?: string;
    lanMode?: boolean;
    allowedOrigin: string;
    capabilities?: Record<string, boolean>;
    serverUrl: string;
    clientName: string;
  };

  export type BackendTarget = {
    id?: string;
    kind?: string;
    url?: string;
    localUrl?: string;
    lanUrl?: string;
    port?: number;
    apiVersion?: string;
    authMode?: string;
    authUser?: string;
    lanMode?: boolean;
    dataDirName?: string;
    localDataDir?: string;
    capabilities?: Record<string, boolean>;
    reachable?: boolean;
    source?: string;
  };

  export type BackendEvent = {
    id: string;
    type: string;
    createdAt: string;
    projectId?: string;
    revisionToken?: string;
    reason?: string;
    lock?: ProjectLock | null;
    [key: string]: unknown;
  };

  export type FolderEntry = {
    name: string;
    path: string;
    is_file: boolean;
    children?: FolderEntry[];
  };

  export type FolderScanOptions = {
    maxDepth?: number;
    maxEntries?: number;
  };

  export type ProjectReference = {
    name: string;
    projectId: string;
    createdAt?: string;
    updatedAt?: string;
    created?: boolean;
    project?: ServerProject & {
      etag?: string;
      revisionToken?: string;
    };
  };

  export type BackendStartOptions = {
    port?: number;
    dataDir?: string;
    authUser?: string;
    authPassword?: string;
    noAuth?: boolean;
    skipBuild?: boolean;
    localOnly?: boolean;
    logPath?: string;
  };

  export type BackendStartResult = {
    ok: true;
    pid: number;
    script: string;
    logPath: string;
  };

  export type BackendStopOptions = {
    port?: number;
    portStart?: number;
    portEnd?: number;
  };

  export type BackendStopResult = {
    ok: true;
    script: string;
    portStart: number;
    portEnd: number;
  };

  export type BackendAuthConfig = {
    exists: boolean;
    user: string;
    password: string;
    dataDir: string;
    authPath: string;
  };

  export type BackendAuth = {
    user: string;
    password: string;
  };

  export type BackendConnectionOptions = {
    preferLan?: boolean;
    lanMode?: boolean;
  };

  export type ServerProjectErrorDetail = {
    status: number;
    code?: string;
    message: string;
    recovery: string;
    path: string;
    details?: unknown;
  };

  export class ServerProjectError extends Error {
    constructor(readonly detail: ServerProjectErrorDetail) {
      super(detail.message);
      this.name = "ServerProjectError";
    }

    get status(): number {
      return this.detail.status;
    }

    get code(): string | undefined {
      return this.detail.code;
    }

    get recovery(): string {
      return this.detail.recovery;
    }
  }

  const clientIdStorageKey = "project-graph-web-client-id";
  const clientNameStorageKey = "project-graph-web-client-name";
  const backendUrlStorageKey = "project-graph-backend-url";
  const backendAuthStorageKey = "project-graph-backend-auth-by-url";
  const autoStartLanBackendStorageKey = "project-graph-auto-start-lan-backend";
  const projectEtags = new Map<string, string>();
  let activeServerBaseUrl: string | undefined;
  let activeBackendAuth: BackendAuth | undefined;
  let backendConnectionPromise: Promise<string> | undefined;

  export function projectUri(id: string): URI {
    return URI.parse(`server:/projects/${encodeURIComponent(id)}`);
  }

  export function projectIdFromUri(uri: URI): string {
    if (uri.scheme !== "server") {
      throw new Error(`不是服务器项目 URI: ${uri.toString()}`);
    }
    const match = uri.path.match(/^\/projects\/([^/]+)$/);
    if (!match) {
      throw new Error(`服务器项目 URI 格式错误: ${uri.toString()}`);
    }
    return decodeURIComponent(match[1]);
  }

  export async function listProjects(): Promise<ServerProject[]> {
    const data = await apiJson<{ projects: ServerProject[] }>("/api/projects");
    return data.projects;
  }

  export async function getServerInfo(): Promise<ServerInfo> {
    const data = await apiJson<Omit<ServerInfo, "serverUrl" | "clientName">>("/api/server-info");
    return {
      ...data,
      serverUrl: serverBaseUrl() || (typeof window !== "undefined" ? window.location.origin : ""),
      clientName: getClientName(),
    };
  }

  export async function discoverBackendTargets(): Promise<BackendTarget[]> {
    if (!isTauriRuntime()) {
      return [];
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BackendTarget[]>("project_graph_backend_targets");
  }

  export async function getBackendAuthConfig(): Promise<BackendAuthConfig | undefined> {
    if (!isTauriRuntime()) {
      return undefined;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BackendAuthConfig>("project_graph_backend_auth_config");
  }

  export async function startBackendDaemon(options: BackendStartOptions = {}): Promise<BackendStartResult> {
    if (!isTauriRuntime()) {
      throwProjectError({
        status: 0,
        code: "backend_start_unavailable",
        message: "当前环境不能启动本机后端",
        recovery: "请在桌面版中启动本机后端，或手动运行 scripts/start-web.ps1 后填写后端地址。",
        path: "",
      });
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BackendStartResult>("project_graph_backend_start", { options });
  }

  export async function stopBackendDaemon(options: BackendStopOptions = {}): Promise<BackendStopResult> {
    if (!isTauriRuntime()) {
      throwProjectError({
        status: 0,
        code: "backend_stop_unavailable",
        message: "当前环境不能关闭本机后端",
        recovery: "请在桌面版中关闭本机后端，或手动运行 scripts/stop-web.ps1。",
        path: "",
      });
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BackendStopResult>("project_graph_backend_stop", { options });
  }

  export async function ensureBackendConnection(): Promise<string> {
    const configured = serverBaseUrl();
    if (configured) return configured;
    if (!isTauriRuntime()) {
      return typeof window !== "undefined" ? window.location.origin : "";
    }
    if (!backendConnectionPromise) {
      backendConnectionPromise = discoverAndSelectBackend().finally(() => {
        backendConnectionPromise = undefined;
      });
    }
    return backendConnectionPromise;
  }

  export function getServerBaseUrl(): string {
    return serverBaseUrl();
  }

  export function setServerBaseUrl(url: string): string {
    const next = normalizeBackendUrl(url);
    activeServerBaseUrl = next;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(backendUrlStorageKey, next);
    }
    return next;
  }

  export function getStoredServerAuth(url: string = serverBaseUrl()): BackendAuth | undefined {
    const key = parseBackendUrl(url);
    if (!key.ok || typeof localStorage === "undefined") return undefined;
    const authByUrl = readBackendAuthByUrl();
    return authByUrl[key.url];
  }

  export function setStoredServerAuth(url: string, auth: BackendAuth): void {
    const key = parseBackendUrl(url);
    if (!key.ok || typeof localStorage === "undefined") return;
    const authByUrl = readBackendAuthByUrl();
    authByUrl[key.url] = auth;
    localStorage.setItem(backendAuthStorageKey, JSON.stringify(authByUrl));
  }

  export function setServerAuth(auth: BackendAuth | undefined): void {
    activeBackendAuth = auth;
  }

  export function getAutoStartLanBackend(): boolean {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(autoStartLanBackendStorageKey) === "1";
  }

  export function setAutoStartLanBackend(enabled: boolean): void {
    if (typeof localStorage === "undefined") return;
    if (enabled) {
      localStorage.setItem(autoStartLanBackendStorageKey, "1");
    } else {
      localStorage.removeItem(autoStartLanBackendStorageKey);
    }
  }

  export async function connectServerBaseUrl(url: string): Promise<string> {
    const next = normalizeBackendUrl(url);
    const health = await probeBackend(next);
    if (!health.ok) {
      throwProjectError({
        status: 0,
        code: "backend_unreachable",
        message: "无法连接 Project Graph 后端",
        recovery: "请确认后端地址、端口和认证状态正确，然后重试。",
        path: "/api/server-info",
        details: { url: next, error: health.error },
      });
    }
    return setServerBaseUrl(next);
  }

  export async function waitForBackendConnection(
    timeoutMs = 60000,
    options: BackendConnectionOptions = {},
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      const targets = await discoverBackendTargets();
      for (const target of targets) {
        if (options.lanMode !== undefined && target.lanMode !== options.lanMode) continue;
        const url = backendTargetUrl(target, options);
        if (!url) continue;
        const health = await probeBackend(url);
        if (health.ok) {
          return setServerBaseUrl(url);
        }
        lastError = health.error;
      }
      await delay(500);
    }
    throwProjectError({
      status: 0,
      code: "backend_start_timeout",
      message: "本机后端启动超时",
      recovery: "请查看后端启动日志，确认 Node、pnpm 和构建产物是否可用。",
      path: "/api/server-info",
      details: { lastError },
    });
  }

  export function clearServerBaseUrl(): void {
    activeServerBaseUrl = undefined;
    activeBackendAuth = undefined;
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(backendUrlStorageKey);
    }
  }

  export function backendTargetUrl(target: BackendTarget, options: BackendConnectionOptions = {}): string {
    if (options.preferLan) {
      return target.lanUrl || target.localUrl || target.url || "";
    }
    return target.localUrl || target.url || target.lanUrl || "";
  }

  export async function subscribeBackendEvents(onEvent: (event: BackendEvent) => void): Promise<() => void> {
    await ensureBackendConnection();
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let reportedFailure = false;

    const scheduleReconnect = () => {
      if (controller.signal.aborted) return;
      if (reconnectTimer) globalThis.clearTimeout(reconnectTimer);
      reconnectTimer = globalThis.setTimeout(() => void connect(), 1000);
    };

    const connect = async () => {
      try {
        const response = await fetch(apiUrl("/api/events"), {
          headers: clientHeaders(),
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) await throwResponseError(response, "/api/events");
        reportedFailure = false;
        const reader = response.body?.getReader();
        if (reader) {
          await readBackendEventStream(reader, onEvent, controller.signal);
        }
        scheduleReconnect();
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!reportedFailure && error instanceof ServerProjectError) {
          dispatchServerError(error.detail);
        } else if (!reportedFailure) {
          reportedFailure = true;
          dispatchServerError({
            status: 0,
            code: "backend_events_failed",
            message: "后端事件订阅中断",
            recovery: "请确认 Web 后端仍在运行，然后刷新项目列表重试。",
            path: "/api/events",
            details: { error: error instanceof Error ? error.message : String(error) },
          });
        }
        reportedFailure = true;
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      if (reconnectTimer) globalThis.clearTimeout(reconnectTimer);
      controller.abort();
    };
  }

  export async function createProject(name: string): Promise<ServerProject> {
    const data = await apiJson<{ project: ServerProject }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return data.project;
  }

  export async function renameProject(id: string, name: string): Promise<ServerProject> {
    const data = await apiJson<{ project: ServerProject }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return data.project;
  }

  export async function readProjectBlob(id: string): Promise<Uint8Array> {
    const response = await apiFetch(`/api/projects/${encodeURIComponent(id)}/blob`);
    updateProjectEtag(id, response);
    return new Uint8Array(await response.arrayBuffer());
  }

  export async function writeProjectBlob(id: string, content: Uint8Array): Promise<void> {
    const body = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.project-graph",
    };
    const etag = projectEtags.get(id);
    if (etag) headers["If-Match"] = etag;
    const response = await apiFetch(`/api/projects/${encodeURIComponent(id)}/blob`, {
      method: "PUT",
      headers,
      body,
    });
    updateProjectEtag(id, response);
  }

  export function getProjectEtag(id: string): string | undefined {
    return projectEtags.get(id);
  }

  export async function createProjectBackup(id: string, content?: Uint8Array): Promise<ProjectHistoryEntry> {
    const headers: Record<string, string> = {};
    let body: ArrayBuffer | undefined;
    if (content) {
      headers["Content-Type"] = "application/vnd.project-graph";
      body = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
    }
    const data = await apiJson<{ backup: ProjectHistoryEntry }>(`/api/projects/${encodeURIComponent(id)}/backup`, {
      method: "POST",
      headers,
      body,
    });
    return data.backup;
  }

  export async function scanServerFolder(path: string, options: FolderScanOptions = {}): Promise<FolderEntry> {
    const data = await apiJson<{ root: FolderEntry }>("/api/folders/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...options }),
    });
    return data.root;
  }

  export async function listProjectReferences(id: string): Promise<ProjectReference[]> {
    const data = await apiJson<{ references: ProjectReference[] }>(
      `/api/projects/${encodeURIComponent(id)}/references`,
    );
    return data.references;
  }

  export async function resolveProjectReference(id: string, name: string): Promise<ProjectReference | undefined> {
    try {
      const data = await apiJson<{ reference: ProjectReference }>(
        `/api/projects/${encodeURIComponent(id)}/references/${encodeURIComponent(name)}`,
      );
      return data.reference;
    } catch (error) {
      if (error instanceof ServerProjectError && error.code === "project_reference_not_found") {
        return undefined;
      }
      throw error;
    }
  }

  export async function ensureProjectReference(id: string, name: string): Promise<ProjectReference> {
    const data = await apiJson<{ reference: ProjectReference }>(`/api/projects/${encodeURIComponent(id)}/references`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return data.reference;
  }

  export async function projectBlobExists(id: string): Promise<boolean> {
    await ensureBackendConnection();
    const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}/blob`), {
      method: "HEAD",
      headers: clientHeaders(),
      credentials: "same-origin",
    });
    if (response.status === 404) return false;
    if (!response.ok) await throwResponseError(response, `/api/projects/${encodeURIComponent(id)}/blob`);
    updateProjectEtag(id, response);
    return true;
  }

  export async function removeProject(id: string): Promise<void> {
    await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    projectEtags.delete(id);
  }

  export async function lockProject(id: string, ttlSeconds = 300): Promise<ProjectLock> {
    const data = await apiJson<{ lock: ProjectLock }>(`/api/projects/${encodeURIComponent(id)}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: getClientId(), clientName: getClientName(), ttlSeconds }),
    });
    return data.lock;
  }

  export async function unlockProject(id: string): Promise<void> {
    await apiFetch(`/api/projects/${encodeURIComponent(id)}/unlock`, {
      method: "POST",
    });
  }

  export function unlockProjectKeepalive(id: string): void {
    void fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}/unlock`), {
      method: "POST",
      headers: clientHeaders(),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }

  export async function listProjectHistory(id: string): Promise<ProjectHistoryEntry[]> {
    const data = await apiJson<{ history: ProjectHistoryEntry[] }>(`/api/projects/${encodeURIComponent(id)}/history`);
    return data.history;
  }

  export async function restoreProjectRevision(id: string, revision: string): Promise<void> {
    const response = await apiFetch(`/api/projects/${encodeURIComponent(id)}/restore/${encodeURIComponent(revision)}`, {
      method: "POST",
    });
    updateProjectEtag(id, response);
  }

  export function getClientId(): string {
    if (typeof localStorage === "undefined") {
      return "web";
    }
    const existing = localStorage.getItem(clientIdStorageKey);
    if (existing) return existing;
    const next = randomUUID();
    localStorage.setItem(clientIdStorageKey, next);
    return next;
  }

  export function getClientName(): string {
    if (typeof localStorage === "undefined") {
      return "Web";
    }
    const existing = localStorage.getItem(clientNameStorageKey);
    if (existing) return existing;
    const next = `${navigator.platform || "Web"} ${shortClientId(getClientId())}`;
    localStorage.setItem(clientNameStorageKey, next);
    return next;
  }

  export function isLockedByOther(project: ServerProject): boolean {
    return Boolean(project.lock && project.lock.clientId !== getClientId());
  }

  export function formatLockOwner(lock: ProjectLock): string {
    return lock.clientName || shortClientId(lock.clientId);
  }

  export function formatError(error: unknown): string {
    if (error instanceof ServerProjectError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  export function recoveryHint(error: unknown): string {
    if (error instanceof ServerProjectError) {
      return error.recovery;
    }
    return "请确认 Web 后端仍在运行，然后刷新项目列表重试。";
  }

  async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await apiFetch(path, init);
    return (await response.json()) as T;
  }

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    await ensureBackendConnection();
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(clientHeaders())) {
      headers.set(key, value);
    }
    const response = await fetch(apiUrl(path), {
      ...init,
      headers,
      credentials: init.credentials ?? "same-origin",
    });
    if (!response.ok) await throwResponseError(response, path);
    return response;
  }

  function apiUrl(path: string): string {
    const base = serverBaseUrl();
    if (base) {
      return `${base}${path}`;
    }
    if (isBrowserRuntime()) {
      return new URL(path, window.location.origin).toString();
    }
    throwProjectError({
      status: 0,
      code: "backend_unconfigured",
      message: "没有可用的 Project Graph 后端",
      recovery: "先启动本机后端，或输入已经运行的后端地址后重试。",
      path,
    });
  }

  function serverBaseUrl(): string {
    if (activeServerBaseUrl) return activeServerBaseUrl;
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(backendUrlStorageKey);
      if (stored) return stored;
    }
    const envUrl = import.meta.env.LR_PROJECT_GRAPH_SERVER_URL?.replace(/\/$/, "") ?? "";
    if (envUrl) return envUrl;
    if (isBrowserRuntime()) {
      return window.location.origin;
    }
    return "";
  }

  function updateProjectEtag(id: string, response: Response): void {
    const etag = response.headers.get("ETag");
    if (etag) projectEtags.set(id, etag);
  }

  function shortClientId(clientId: string): string {
    return clientId.slice(0, 8);
  }

  function clientHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Project-Graph-Client": getClientId(),
    };
    if (activeBackendAuth) {
      headers.Authorization = basicAuthHeader(activeBackendAuth);
    }
    return headers;
  }

  function readBackendAuthByUrl(): Record<string, BackendAuth> {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(backendAuthStorageKey);
    if (!raw) return {};
    try {
      const value = JSON.parse(raw) as Record<string, BackendAuth>;
      return Object.fromEntries(Object.entries(value).filter(([, auth]) => auth?.user && auth.password));
    } catch (error) {
      dispatchServerError({
        status: 0,
        code: "backend_auth_storage_invalid",
        message: "后端认证缓存格式错误",
        recovery: "已忽略损坏的本地认证缓存，请重新输入后端账号密码。",
        path: "",
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      localStorage.removeItem(backendAuthStorageKey);
      return {};
    }
  }

  function basicAuthHeader(auth: BackendAuth): string {
    const bytes = new TextEncoder().encode(`${auth.user}:${auth.password}`);
    let value = "";
    for (const byte of bytes) {
      value += String.fromCharCode(byte);
    }
    return `Basic ${globalThis.btoa(value)}`;
  }

  async function readBackendEventStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEvent: (event: BackendEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        emitBackendEvent(buffer.slice(0, boundary), onEvent);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    const remaining = decoder.decode();
    if (remaining) {
      buffer += remaining;
      emitBackendEvent(buffer, onEvent);
    }
  }

  function emitBackendEvent(rawEvent: string, onEvent: (event: BackendEvent) => void): void {
    const lines = rawEvent.split("\n");
    const data: string[] = [];
    let eventName = "";
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      const separatorIndex = line.indexOf(":");
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        data.push(value);
      }
    }
    if (data.length === 0) return;
    const event = JSON.parse(data.join("\n")) as BackendEvent;
    if (!event.type && eventName) {
      event.type = eventName;
    }
    onEvent(event);
  }

  async function throwResponseError(response: Response, path: string): Promise<never> {
    let message = `${response.status} ${response.statusText}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const data = (await response.clone().json()) as { code?: string; error?: string; details?: unknown };
      if (data.error) message = data.error;
      code = data.code;
      details = data.details;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = text;
    }
    let recovery = "请确认 Web 后端仍在运行，然后刷新项目列表重试。";
    if (response.status === 423) {
      message = "项目正在被另一台设备编辑，请稍后再试";
      recovery = "刷新项目列表查看锁定者；如果是自己的旧页面占用，关闭旧页面后等待锁过期。";
    } else if (response.status === 412) {
      message = "服务器上的项目版本已经变化，请刷新后再保存";
      recovery = "先刷新项目列表确认最新更新时间；如当前画布仍有未保存内容，请另存为本地 .prg 后再重新打开服务器项目。";
    } else if (response.status === 401) {
      message = "需要 Web 后端认证";
      recovery = "请使用启动脚本输出的账号密码访问 Web 页面，或检查浏览器是否仍保留认证状态。";
    }
    const detail = { status: response.status, code, message, recovery, path, details };
    throwProjectError(detail);
  }

  function dispatchServerError(detail: ServerProjectErrorDetail): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<ServerProjectErrorDetail>(errorEventName, { detail }));
  }

  async function discoverAndSelectBackend(): Promise<string> {
    const targets = await discoverBackendTargets();
    let lastError = "";
    for (const target of targets) {
      const url = backendTargetUrl(target);
      if (!url) continue;
      const health = await probeBackend(url);
      if (health.ok) {
        return setServerBaseUrl(url);
      }
      lastError = health.error;
    }
    throwProjectError({
      status: 0,
      code: "backend_not_found",
      message: "没有发现正在运行的 Project Graph 后端",
      recovery: "点击启动本机后端，或在地址栏输入 http://127.0.0.1:<端口> 后连接。",
      path: "/api/server-info",
      details: { targets, lastError },
    });
  }

  async function probeBackend(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const parsed = parseBackendUrl(url);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const base = parsed.url;
      const response = await fetch(`${base}/api/server-info`, { headers: clientHeaders() });
      if (!response.ok) {
        return { ok: false, error: `${response.status} ${response.statusText}` };
      }
      const data = (await response.json()) as { ok?: boolean };
      return data.ok ? { ok: true } : { ok: false, error: "后端状态响应不是 ok" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function normalizeBackendUrl(url: string): string {
    const parsed = parseBackendUrl(url);
    if (parsed.ok) return parsed.url;
    if (parsed.error === "empty") {
      throwProjectError({
        status: 0,
        code: "backend_url_required",
        message: "后端地址不能为空",
        recovery: "请输入类似 http://127.0.0.1:37820 的后端地址。",
        path: "",
      });
    }
    throwProjectError({
      status: 0,
      code: "invalid_backend_url",
      message: "后端地址格式不正确",
      recovery: "请输入完整地址，例如 http://127.0.0.1:37820。",
      path: "",
      details: { url },
    });
  }

  function parseBackendUrl(url: string): { ok: true; url: string } | { ok: false; error: string } {
    const trimmed = url.trim().replace(/\/$/, "");
    if (!trimmed) return { ok: false, error: "empty" };
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "unsupported_protocol" };
      }
      return { ok: true, url: parsed.toString().replace(/\/$/, "") };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function throwProjectError(detail: ServerProjectErrorDetail): never {
    dispatchServerError(detail);
    throw new ServerProjectError(detail);
  }

  async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  }
}
