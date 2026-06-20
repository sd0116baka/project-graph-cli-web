import { Project, ProjectState, service } from "@/core/Project";
import { toast } from "sonner";
import { ServerProjectManager } from "./ServerProjectManager";

@service("serverProjectRemoteSync")
export class ServerProjectRemoteSyncService {
  private readonly projectId: string | undefined;
  private unsubscribe: (() => void) | undefined;
  private reloadPromise: Promise<void> | undefined;
  private disposed = false;
  private lastDirtyRevisionWarning: string | undefined;

  constructor(private readonly project: Project) {
    if (project.uri.scheme !== "server") return;
    this.projectId = ServerProjectManager.projectIdFromUri(project.uri);
    void this.subscribe();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async subscribe(): Promise<void> {
    try {
      const unsubscribe = await ServerProjectManager.subscribeBackendEvents((event) => this.handleBackendEvent(event));
      if (this.disposed) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;
    } catch (error) {
      if (!this.disposed) {
        toast.error(`服务器项目同步订阅失败：${ServerProjectManager.formatError(error)}`);
      }
    }
  }

  private handleBackendEvent(event: ServerProjectManager.BackendEvent): void {
    if (!this.projectId || event.type !== "project_updated" || event.projectId !== this.projectId) return;
    if (event.revisionToken && event.revisionToken === ServerProjectManager.getProjectEtag(this.projectId)) return;
    if (this.project.isSaving) return;

    if (this.project.projectState !== ProjectState.Saved) {
      this.warnDirtyProject(event.revisionToken);
      return;
    }
    if (this.reloadPromise) return;

    const reload = this.reloadFromServer();
    this.reloadPromise = reload;
    void reload.finally(() => {
      if (this.reloadPromise === reload) {
        this.reloadPromise = undefined;
      }
    });
  }

  private warnDirtyProject(revisionToken: string | undefined): void {
    const warningKey = revisionToken ?? "unknown";
    if (this.lastDirtyRevisionWarning === warningKey) return;
    this.lastDirtyRevisionWarning = warningKey;
    toast.warning("服务器项目已有新版本。当前画布有未保存修改，请另存或刷新后再继续编辑。");
  }

  private async reloadFromServer(): Promise<void> {
    try {
      await this.project.init({ interactive: false, allowUpgrade: true });
      if (this.disposed) return;
      this.project.historyManager.clearHistory();
      this.project.loop();
      this.lastDirtyRevisionWarning = undefined;
      toast.success("服务器项目已同步最新版本");
    } catch (error) {
      if (!this.disposed) {
        toast.error(`服务器项目同步失败：${ServerProjectManager.formatError(error)}`);
      }
    }
  }
}
