import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { onNewServerProject, onOpenServerProject } from "@/core/service/GlobalMenu";
import { FolderOpen, History, LoaderCircle, Lock, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function ServerProjectBrowser() {
  const [projects, setProjects] = useState<ServerProjectManager.ServerProject[]>([]);
  const [history, setHistory] = useState<ServerProjectManager.ProjectHistoryEntry[]>([]);
  const [projectName, setProjectName] = useState("");
  const [historyProjectId, setHistoryProjectId] = useState("");
  const [busyProjectId, setBusyProjectId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    void refreshProjects();
  }, []);

  async function refreshProjects() {
    setIsRefreshing(true);
    try {
      setProjects(await ServerProjectManager.listProjects());
      if (historyProjectId) {
        setHistory(await ServerProjectManager.listProjectHistory(historyProjectId));
      }
    } catch (error) {
      toast.error(`读取服务器项目失败：${String(error)}`);
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
      toast.error(`创建服务器项目失败：${String(error)}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function renameProject(project: ServerProjectManager.ServerProject) {
    const name = window.prompt("新的项目名称", project.name)?.trim();
    if (!name || name === project.name) return;
    setBusyAction(`rename:${project.id}`);
    try {
      await ServerProjectManager.renameProject(project.id, name);
      await refreshProjects();
      toast.success("项目已重命名");
    } catch (error) {
      toast.error(`重命名服务器项目失败：${String(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function removeProject(project: ServerProjectManager.ServerProject) {
    if (!window.confirm(`确定删除“${project.name}”？历史备份也会一起删除。`)) return;
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
      toast.error(`删除服务器项目失败：${String(error)}`);
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
      toast.error(`读取历史备份失败：${String(error)}`);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function restoreHistory(projectId: string, revision: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!window.confirm(`确定恢复“${project?.name ?? projectId}”到这个历史版本？当前版本会先写入历史备份。`)) return;
    setBusyAction(`restore:${revision}`);
    try {
      await ServerProjectManager.restoreProjectRevision(projectId, revision);
      await refreshProjects();
      setHistory(await ServerProjectManager.listProjectHistory(projectId));
      toast.success("历史版本已恢复");
    } catch (error) {
      toast.error(`恢复历史备份失败：${String(error)}`);
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
      toast.error(`打开服务器项目失败：${String(error)}`);
    } finally {
      setBusyProjectId("");
    }
  }

  const historyProject = projects.find((project) => project.id === historyProjectId);
  const historyLockedByOther = historyProject ? ServerProjectManager.isLockedByOther(historyProject) : false;

  return (
    <div className="flex min-w-80 flex-col gap-3">
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
        {projects.map((project) => {
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
                <span className="block truncate text-sm">{project.name}</span>
                <span className="block truncate text-xs opacity-50">
                  {lockStatus(project, lockedByOther, lockedBySelf) ??
                    `${new Date(project.updatedAt).toLocaleString()} · ${formatBytes(project.size)}`}
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
        })}
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

function lockStatus(
  project: ServerProjectManager.ServerProject,
  lockedByOther: boolean,
  lockedBySelf: boolean,
): string | undefined {
  if (!project.lock) return undefined;
  const owner = ServerProjectManager.formatLockOwner(project.lock);
  const expiresAt = new Date(project.lock.expiresAt).toLocaleTimeString();
  if (lockedByOther) return `${owner} 正在编辑，锁定至 ${expiresAt}`;
  if (lockedBySelf) return `本机正在编辑，锁定至 ${expiresAt}`;
  return undefined;
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
