import { URI } from "vscode-uri";

export namespace ServerProjectManager {
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

  const clientIdStorageKey = "project-graph-web-client-id";
  const clientNameStorageKey = "project-graph-web-client-name";
  const projectEtags = new Map<string, string>();

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
    const response = await fetch(apiUrl(`/api/projects/${encodeURIComponent(id)}/blob`), {
      method: "HEAD",
      headers: clientHeaders(),
    });
    if (response.status === 404) return false;
    if (!response.ok) await throwResponseError(response);
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

  async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await apiFetch(path, init);
    return (await response.json()) as T;
  }

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(clientHeaders())) {
      headers.set(key, value);
    }
    const response = await fetch(apiUrl(path), {
      ...init,
      headers,
    });
    if (!response.ok) await throwResponseError(response);
    return response;
  }

  function apiUrl(path: string): string {
    const base = import.meta.env.LR_PROJECT_GRAPH_SERVER_URL?.replace(/\/$/, "") ?? "";
    if (base) {
      return `${base}${path}`;
    }
    if (typeof window !== "undefined") {
      return new URL(path, window.location.origin).toString();
    }
    return path;
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

  async function throwResponseError(response: Response): Promise<never> {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = text;
    }
    if (response.status === 423) {
      message = "项目正在被另一台设备编辑，请稍后再试";
    } else if (response.status === 412) {
      message = "服务器上的项目版本已经变化，请刷新后再保存";
    }
    throw new Error(message);
  }
}
