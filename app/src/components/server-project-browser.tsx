import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { onNewServerProject, onOpenServerProject } from "@/core/service/GlobalMenu";
import { isWeb } from "@/utils/platform";
import {
  AlertTriangle,
  Cable,
  FolderOpen,
  HardDrive,
  History,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function ServerProjectBrowser() {
  const [projects, setProjects] = useState<ServerProjectManager.ServerProject[]>([]);
  const [history, setHistory] = useState<ServerProjectManager.ProjectHistoryEntry[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerProjectManager.ServerInfo | undefined>();
  const [backendTargets, setBackendTargets] = useState<ServerProjectManager.BackendTarget[]>([]);
  const [activeBackendUrl, setActiveBackendUrl] = useState(ServerProjectManager.getServerBaseUrl());
  const [backendUrlInput, setBackendUrlInput] = useState(ServerProjectManager.getServerBaseUrl());
  const [useLanBackend, setUseLanBackend] = useState(true);
  const [backendAdminUser, setBackendAdminUser] = useState(readBackendAdminUser);
  const [backendAdminPassword, setBackendAdminPassword] = useState(readBackendAdminPassword);
  const [startedBackendPort, setStartedBackendPort] = useState<number | undefined>();
  const [startedBackendAuth, setStartedBackendAuth] = useState<ServerProjectManager.BackendAuth | undefined>();
  const [lastFailure, setLastFailure] = useState<ServerProjectManager.ServerProjectErrorDetail | undefined>();
  const [projectName, setProjectName] = useState("");
  const [historyProjectId, setHistoryProjectId] = useState("");
  const [busyProjectId, setBusyProjectId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStartingBackend, setIsStartingBackend] = useState(false);
  const [isStoppingBackend, setIsStoppingBackend] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    applyBackendAuth();
  }, [useLanBackend, backendAdminUser, backendAdminPassword]);

  useEffect(() => {
    void refreshProjects();

    const onServerError = (event: Event) => {
      setLastFailure((event as CustomEvent<ServerProjectManager.ServerProjectErrorDetail>).detail);
    };
    let eventSubscription: (() => void) | undefined;
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleEventRefresh = () => {
      if (refreshTimer) globalThis.clearTimeout(refreshTimer);
      refreshTimer = globalThis.setTimeout(() => void refreshProjects(), 250);
    };
    void ServerProjectManager.subscribeBackendEvents((event) => {
      if (shouldRefreshForBackendEvent(event)) {
        scheduleEventRefresh();
      }
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          eventSubscription = dispose;
        }
      })
      .catch((error) => {
        reportFailure(error, "订阅后端事件失败");
      });
    window.addEventListener(ServerProjectManager.errorEventName, onServerError);
    return () => {
      disposed = true;
      eventSubscription?.();
      if (refreshTimer) globalThis.clearTimeout(refreshTimer);
      window.removeEventListener(ServerProjectManager.errorEventName, onServerError);
    };
  }, []);

  async function refreshProjects() {
    setIsRefreshing(true);
    try {
      const backendUrl = await ServerProjectManager.ensureBackendConnection();
      setActiveBackendUrl(backendUrl);
      setBackendUrlInput(backendUrl);
      await refreshBackendTargets();
      const nextProjects = await ServerProjectManager.listProjects();
      setProjects(nextProjects);
      setLastFailure(undefined);
      try {
        setServerInfo(await ServerProjectManager.getServerInfo());
      } catch (error) {
        setServerInfo(undefined);
        toast.warning(`读取后端状态失败：${ServerProjectManager.formatError(error)}`);
      }
      if (historyProjectId) {
        setHistory(await ServerProjectManager.listProjectHistory(historyProjectId));
      }
    } catch (error) {
      reportFailure(error, "读取服务器项目失败");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function refreshBackendTargets() {
    const targets = await ServerProjectManager.discoverBackendTargets();
    setBackendTargets(targets);
    if (startedBackendPort !== undefined && !targets.some((target) => target.port === startedBackendPort)) {
      setStartedBackendPort(undefined);
      setStartedBackendAuth(undefined);
      applyBackendAuth();
    }
  }

  async function connectBackend(url = backendUrlInput) {
    const auth = applyBackendAuth();
    if (useLanBackend && !auth) {
      toast.error("请先设置 LAN 管理员账号和密码");
      return;
    }
    setIsConnecting(true);
    try {
      const next = await ServerProjectManager.connectServerBaseUrl(url);
      setActiveBackendUrl(next);
      setBackendUrlInput(next);
      await refreshProjects();
      toast.success("已连接 Project Graph 后端");
    } catch (error) {
      reportFailure(error, "连接后端失败");
    } finally {
      setIsConnecting(false);
    }
  }

  async function connectBackendTarget(target: ServerProjectManager.BackendTarget) {
    const url = ServerProjectManager.backendTargetUrl(target);
    if (!url) return;
    await connectBackend(url);
  }

  async function startBackend() {
    const lanMode = useLanBackend;
    const auth = lanMode ? backendAdminAuth() : undefined;
    if (lanMode && !auth) {
      toast.error("请先设置 LAN 管理员账号和密码");
      return;
    }
    setIsStartingBackend(true);
    try {
      if (auth) {
        persistBackendAdminAuth(auth);
        setBackendAdminUser(auth.user);
        setBackendAdminPassword(auth.password);
      }
      ServerProjectManager.clearServerBaseUrl();
      ServerProjectManager.setServerAuth(auth);
      const started = await ServerProjectManager.startBackendDaemon({
        authUser: auth?.user,
        authPassword: auth?.password,
        noAuth: !lanMode,
        localOnly: !lanMode,
      });
      toast.info(lanMode ? "LAN 后端正在启动" : "本机后端正在启动");
      const backendUrl = await ServerProjectManager.waitForBackendConnection(60000, {
        lanMode,
        preferLan: lanMode,
      });
      setActiveBackendUrl(backendUrl);
      setBackendUrlInput(backendUrl);
      const info = await ServerProjectManager.getServerInfo();
      setServerInfo(info);
      setStartedBackendPort(info.port);
      setStartedBackendAuth(auth);
      await refreshProjects();
      toast.success(`${lanMode ? "LAN" : "本机"}后端已启动，日志：${started.logPath}`);
    } catch (error) {
      setStartedBackendPort(undefined);
      setStartedBackendAuth(undefined);
      applyBackendAuth();
      reportFailure(error, "启动后端失败");
    } finally {
      setIsStartingBackend(false);
    }
  }

  async function stopStartedBackend() {
    if (startedBackendPort === undefined) return;
    setIsStoppingBackend(true);
    try {
      await ServerProjectManager.stopBackendDaemon({ port: startedBackendPort });
      ServerProjectManager.clearServerBaseUrl();
      setActiveBackendUrl("");
      setBackendUrlInput("");
      setServerInfo(undefined);
      setProjects([]);
      setHistory([]);
      setHistoryProjectId("");
      setStartedBackendPort(undefined);
      setStartedBackendAuth(undefined);
      applyBackendAuth();
      await refreshBackendTargets();
      toast.success("后端已关闭");
    } catch (error) {
      reportFailure(error, "关闭后端失败");
    } finally {
      setIsStoppingBackend(false);
    }
  }

  async function createProject() {
    const name = projectName.trim() || "Untitled Project";
    setIsCreating(true);
    try {
      await onNewServerProject(name);
      setProjectName("");
      await refreshProjects();
    } catch (error) {
      reportFailure(error, "创建服务器项目失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function renameProject(project: ServerProjectManager.ServerProject) {
    const name = (
      await Dialog.input("重命名服务器项目", "输入新的项目名称。", {
        defaultValue: project.name,
        placeholder: "项目名称",
      })
    )?.trim();
    if (!name || name === project.name) return;
    setBusyAction(`rename:${project.id}`);
    try {
      await ServerProjectManager.renameProject(project.id, name);
      await refreshProjects();
      toast.success("项目已重命名");
    } catch (error) {
      reportFailure(error, "重命名服务器项目失败");
    } finally {
      setBusyAction("");
    }
  }

  async function removeProject(project: ServerProjectManager.ServerProject) {
    const confirmed = await Dialog.confirm(
      "删除服务器项目",
      `确定删除“${project.name}”？\n\n项目文件和历史备份都会一起删除。`,
      { destructive: true },
    );
    if (!confirmed) return;
    setBusyAction(`delete:${project.id}`);
    try {
      await ServerProjectManager.removeProject(project.id);
      if (historyProjectId === project.id) {
        setHistoryProjectId("");
        setHistory([]);
      }
      await refreshProjects();
      toast.success("项目已删除");
    } catch (error) {
      reportFailure(error, "删除服务器项目失败");
    } finally {
      setBusyAction("");
    }
  }

  async function loadHistory(project: ServerProjectManager.ServerProject) {
    if (historyProjectId === project.id) {
      setHistoryProjectId("");
      setHistory([]);
      return;
    }
    setHistoryProjectId(project.id);
    setIsLoadingHistory(true);
    try {
      setHistory(await ServerProjectManager.listProjectHistory(project.id));
    } catch (error) {
      reportFailure(error, "读取历史备份失败");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function restoreHistory(projectId: string, revision: string) {
    const project = projects.find((item) => item.id === projectId);
    const entry = history.find((item) => item.revision === revision);
    const confirmed = await Dialog.confirm(
      "恢复历史版本",
      `确定恢复“${project?.name ?? projectId}”？\n\n目标版本：${entry ? new Date(entry.createdAt).toLocaleString() : revision}\n当前版本会先写入新的历史备份。`,
    );
    if (!confirmed) return;
    setBusyAction(`restore:${revision}`);
    try {
      await ServerProjectManager.restoreProjectRevision(projectId, revision);
      await refreshProjects();
      setHistory(await ServerProjectManager.listProjectHistory(projectId));
      toast.success("历史版本已恢复");
    } catch (error) {
      reportFailure(error, "恢复历史备份失败");
    } finally {
      setBusyAction("");
    }
  }

  async function openProject(id: string) {
    setBusyProjectId(id);
    try {
      await onOpenServerProject(id);
      await refreshProjects();
    } catch (error) {
      reportFailure(error, "打开服务器项目失败");
    } finally {
      setBusyProjectId("");
    }
  }

  function reportFailure(error: unknown, title: string) {
    const message = ServerProjectManager.formatError(error);
    const recovery = ServerProjectManager.recoveryHint(error);
    const detail =
      error instanceof ServerProjectManager.ServerProjectError
        ? error.detail
        : { status: 0, message, recovery, path: "", code: undefined, details: undefined };
    setLastFailure(detail);
    toast.error(`${title}：${message}`);
  }

  function backendAdminAuth(): ServerProjectManager.BackendAuth | undefined {
    return createBackendAdminAuth(backendAdminUser, backendAdminPassword);
  }

  function applyBackendAuth(lanMode = useLanBackend): ServerProjectManager.BackendAuth | undefined {
    const auth = lanMode ? backendAdminAuth() : undefined;
    ServerProjectManager.setServerAuth(auth);
    return auth;
  }

  function updateBackendAdminUser(value: string) {
    setBackendAdminUser(value);
    writeLocalStorage(backendAdminUserStorageKey, value.trim() || defaultBackendAdminUser);
  }

  function updateBackendAdminPassword(value: string) {
    setBackendAdminPassword(value);
    writeLocalStorage(backendAdminPasswordStorageKey, value);
  }

  const historyProject = projects.find((project) => project.id === historyProjectId);
  const historyLockedByOther = historyProject ? ServerProjectManager.isLockedByOther(historyProject) : false;
  const lockedProjectCount = projects.filter((project) => project.lock).length;
  const backendModeLocked = startedBackendPort !== undefined || isStartingBackend || isStoppingBackend;
  const configuredBackendAuth = backendAdminAuth();

  return (
    <div className="flex min-w-80 flex-col gap-3 sm:min-w-96">
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Server />
            <span className="truncate text-sm font-medium">Project Graph Web</span>
          </div>
          <Badge variant={serverInfo?.authEnabled ? "secondary" : "outline"}>
            {serverInfo?.authEnabled ? "已认证" : "本地访问"}
          </Badge>
        </div>
        <div className="text-muted-foreground grid gap-1 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <Server />
            <span className="truncate">{serverInfo?.serverUrl || activeBackendUrl || "未连接后端"}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <HardDrive />
            <span className="truncate">
              {serverInfo
                ? `${serverInfo.customDataDir ? "自定义数据目录" : "默认数据目录"}：${serverInfo.dataDirName}`
                : "后端状态未读取"}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Lock />
            <span className="truncate">
              {projects.length} 个项目，{lockedProjectCount} 个有活动锁，本机标识 {serverInfo?.clientName ?? "Web"}
            </span>
          </div>
          {startedBackendAuth && serverInfo?.lanMode && (
            <div className="flex min-w-0 items-center gap-2">
              <Lock />
              <span className="truncate">
                LAN 管理员 {startedBackendAuth.user} / {startedBackendAuth.password}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="min-w-0 flex-1"
            value={backendUrlInput}
            placeholder="http://127.0.0.1:37820"
            onChange={(event) => setBackendUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void connectBackend();
              }
            }}
          />
          {!isWeb && (
            <label
              className={`border-input flex h-9 shrink-0 items-center gap-2 rounded-md border px-2 text-xs ${
                backendModeLocked ? "opacity-50" : ""
              }`}
              title="启动为 LAN 共享后端"
            >
              <Checkbox
                checked={useLanBackend}
                disabled={backendModeLocked}
                onCheckedChange={(checked) => setUseLanBackend(checked === true)}
              />
              <span>LAN</span>
            </label>
          )}
          <Button
            size="icon"
            variant="outline"
            title="连接后端"
            disabled={isConnecting}
            onClick={() => void connectBackend()}
          >
            {isConnecting ? <LoaderCircle className="animate-spin" /> : <Cable />}
          </Button>
          {!isWeb && (
            <Button
              size="icon"
              variant="outline"
              title={startedBackendPort === undefined ? "启动后端" : "关闭后端"}
              disabled={isStartingBackend || isStoppingBackend}
              onClick={() => void (startedBackendPort === undefined ? startBackend() : stopStartedBackend())}
            >
              {isStartingBackend || isStoppingBackend ? (
                <LoaderCircle className="animate-spin" />
              ) : startedBackendPort === undefined ? (
                <Power />
              ) : (
                <PowerOff />
              )}
            </Button>
          )}
        </div>
        {!isWeb && useLanBackend && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <Input
              value={backendAdminUser}
              placeholder="管理员账号"
              disabled={backendModeLocked}
              autoComplete="username"
              onChange={(event) => updateBackendAdminUser(event.target.value)}
            />
            <Input
              value={backendAdminPassword}
              placeholder={configuredBackendAuth ? "管理员密码" : "首次设置管理员密码"}
              disabled={backendModeLocked}
              autoComplete="new-password"
              onChange={(event) => updateBackendAdminPassword(event.target.value)}
            />
          </div>
        )}
        {backendTargets.length > 0 && (
          <div className="flex max-h-20 flex-col gap-1 overflow-auto">
            {backendTargets.map((target, index) => {
              const targetUrl = ServerProjectManager.backendTargetUrl(target);
              if (!targetUrl) return null;
              return (
                <button
                  key={`${target.id ?? targetUrl}:${index}`}
                  type="button"
                  className="hover:bg-accent flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs"
                  onClick={() => void connectBackendTarget(target)}
                >
                  <Server className="size-3.5 shrink-0" />
                  <span className="truncate">{targetUrl}</span>
                  {target.authMode && <Badge variant="outline">{target.authMode}</Badge>}
                  {target.lanMode && <Badge variant="secondary">LAN</Badge>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {lastFailure && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{lastFailure.message}</AlertTitle>
          <AlertDescription>
            <p>{lastFailure.recovery}</p>
            <Button size="sm" variant="outline" onClick={() => void refreshProjects()}>
              <RefreshCw data-icon="inline-start" />
              刷新项目列表
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={projectName}
          placeholder="项目名称"
          onChange={(event) => setProjectName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void createProject();
            }
          }}
        />
        <Button size="icon" disabled={isCreating} onClick={() => void createProject()}>
          {isCreating ? <LoaderCircle className="animate-spin" /> : <Plus />}
        </Button>
        <Button size="icon" variant="outline" disabled={isRefreshing} onClick={() => void refreshProjects()}>
          <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-auto">
        {projects.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
            还没有服务器项目
          </div>
        ) : (
          projects.map((project) => {
            const lockedByOther = ServerProjectManager.isLockedByOther(project);
            const lockedBySelf = Boolean(project.lock && !lockedByOther);
            const actionDisabled = busyAction.endsWith(`:${project.id}`) || lockedByOther;
            return (
              <div
                key={project.id}
                className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
              >
                {lockedByOther ? <Lock /> : <FolderOpen />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="block truncate text-sm">{project.name}</span>
                    {lockedByOther && <Badge variant="destructive">被占用</Badge>}
                    {lockedBySelf && <Badge variant="secondary">本机编辑</Badge>}
                    {!project.exists && <Badge variant="outline">空项目</Badge>}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {projectLine(project, lockedByOther, lockedBySelf)}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="打开"
                    disabled={busyProjectId === project.id || lockedByOther}
                    onClick={() => void openProject(project.id)}
                  >
                    {busyProjectId === project.id ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="重命名"
                    disabled={actionDisabled}
                    onClick={() => void renameProject(project)}
                  >
                    {busyAction === `rename:${project.id}` ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                  </Button>
                  <Button size="icon" variant="ghost" title="历史备份" onClick={() => void loadHistory(project)}>
                    <History />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="删除"
                    disabled={actionDisabled}
                    onClick={() => void removeProject(project)}
                  >
                    {busyAction === `delete:${project.id}` ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {historyProjectId && (
        <div className="border-border flex max-h-52 flex-col gap-1 overflow-auto border-t pt-2">
          {isLoadingHistory ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs opacity-60">
              <LoaderCircle className="animate-spin" />
              <span>正在读取历史备份</span>
            </div>
          ) : history.length === 0 ? (
            <div className="px-2 py-2 text-xs opacity-60">暂无历史备份</div>
          ) : (
            history.map((entry) => (
              <div key={entry.revision} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{new Date(entry.createdAt).toLocaleString()}</span>
                  <span className="block truncate text-xs opacity-50">{formatBytes(entry.size)}</span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  title="恢复"
                  disabled={busyAction === `restore:${entry.revision}` || historyLockedByOther}
                  onClick={() => void restoreHistory(historyProjectId, entry.revision)}
                >
                  {busyAction === `restore:${entry.revision}` ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const defaultBackendAdminUser = "pg";
const backendAdminUserStorageKey = "project-graph-lan-backend-admin-user";
const backendAdminPasswordStorageKey = "project-graph-lan-backend-admin-password";

function readBackendAdminUser(): string {
  return readLocalStorage(backendAdminUserStorageKey) || defaultBackendAdminUser;
}

function readBackendAdminPassword(): string {
  return readLocalStorage(backendAdminPasswordStorageKey);
}

function createBackendAdminAuth(user: string, password: string): ServerProjectManager.BackendAuth | undefined {
  const normalizedUser = user.trim() || defaultBackendAdminUser;
  const normalizedPassword = password.trim();
  if (!normalizedPassword) return undefined;
  return { user: normalizedUser, password: normalizedPassword };
}

function persistBackendAdminAuth(auth: ServerProjectManager.BackendAuth) {
  writeLocalStorage(backendAdminUserStorageKey, auth.user);
  writeLocalStorage(backendAdminPasswordStorageKey, auth.password);
}

function readLocalStorage(key: string): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}

function writeLocalStorage(key: string, value: string) {
  if (typeof localStorage === "undefined") return;
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
}

function projectLine(
  project: ServerProjectManager.ServerProject,
  lockedByOther: boolean,
  lockedBySelf: boolean,
): string {
  if (!project.lock) return `${new Date(project.updatedAt).toLocaleString()} · ${formatBytes(project.size)}`;
  const owner = ServerProjectManager.formatLockOwner(project.lock);
  const expiresAt = new Date(project.lock.expiresAt).toLocaleTimeString();
  if (lockedByOther) return `${owner} 正在编辑，锁定至 ${expiresAt}`;
  if (lockedBySelf) return `本机正在编辑，锁定至 ${expiresAt}`;
  return `${new Date(project.updatedAt).toLocaleString()} · ${formatBytes(project.size)}`;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function shouldRefreshForBackendEvent(event: ServerProjectManager.BackendEvent): boolean {
  return (
    event.type === "project_created" ||
    event.type === "project_imported" ||
    event.type === "project_renamed" ||
    event.type === "project_deleted" ||
    event.type === "project_updated" ||
    event.type === "history_changed" ||
    event.type === "lock_changed"
  );
}
