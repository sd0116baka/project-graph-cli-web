import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { onNewServerProject, onOpenServerProject } from "@/core/service/GlobalMenu";
import {
  AlertTriangle,
  FolderOpen,
  HardDrive,
  History,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
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
  const [lastFailure, setLastFailure] = useState<ServerProjectManager.ServerProjectErrorDetail | undefined>();
  const [projectName, setProjectName] = useState("");
  const [historyProjectId, setHistoryProjectId] = useState("");
  const [busyProjectId, setBusyProjectId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    void refreshProjects();

    const onServerError = (event: Event) => {
      setLastFailure((event as CustomEvent<ServerProjectManager.ServerProjectErrorDetail>).detail);
    };
    window.addEventListener(ServerProjectManager.errorEventName, onServerError);
    return () => {
      window.removeEventListener(ServerProjectManager.errorEventName, onServerError);
    };
  }, []);

  async function refreshProjects() {
    setIsRefreshing(true);
    try {
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

  const historyProject = projects.find((project) => project.id === historyProjectId);
  const historyLockedByOther = historyProject ? ServerProjectManager.isLockedByOther(historyProject) : false;
  const lockedProjectCount = projects.filter((project) => project.lock).length;

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
            <span className="truncate">{serverInfo?.serverUrl || "正在读取后端地址"}</span>
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
        </div>
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
