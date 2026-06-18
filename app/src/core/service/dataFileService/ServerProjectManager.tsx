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

  export type BackendStartOptions = {
    port?: number;
    dataDir?: string;
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
  const projectEtags = new Map<string, string>();
  let activeServerBaseUrl: string | undefined;
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

  export async function waitForBackendConnection(timeoutMs = 60000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      const targets = await discoverBackendTargets();
      for (const target of targets) {
        const url = backendTargetUrl(target);
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
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(backendUrlStorageKey);
    }
  }

  export function backendTargetUrl(target: BackendTarget): string {
    return target.localUrl || target.url || target.lanUrl || "";
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

  export async function projectBlobExists(id: string): Promise<boolean> {
    await ensureBackendConnection();
    const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}/blob`), {
      method: "HEAD",
      headers: clientHeaders(),
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
    const next = crypto.randomUUID();
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
    });
    if (!response.ok) await throwResponseError(response, path);
    return response;
  }

  function apiUrl(path: string): string {
    const base = serverBaseUrl();
    if (base) {
      return `${base}${path}`;
    }
    if (typeof window !== "undefined" && !isTauriRuntime()) {
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

  function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function serverBaseUrl(): string {
    if (activeServerBaseUrl) return activeServerBaseUrl;
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(backendUrlStorageKey);
      if (stored) return stored;
    }
    const envUrl = import.meta.env.LR_PROJECT_GRAPH_SERVER_URL?.replace(/\/$/, "") ?? "";
    if (envUrl) return envUrl;
    if (typeof window !== "undefined" && !isTauriRuntime()) {
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
    return {
      "X-Project-Graph-Client": getClientId(),
    };
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
