import { Project, service } from "@/core/Project";
import { toast } from "sonner";
import { ServerProjectManager } from "./ServerProjectManager";

@service("serverProjectLock")
export class ServerProjectLockService {
  private readonly projectId: string | undefined;
  private readonly heartbeatMs = 120_000;
  private heartbeatHandle: number | undefined;
  private disposed = false;

  constructor(private readonly project: Project) {
    if (project.uri.scheme !== "server") return;
    this.projectId = ServerProjectManager.projectIdFromUri(project.uri);
    this.heartbeatHandle = window.setInterval(() => void this.renewLock(), this.heartbeatMs);
    window.addEventListener("pagehide", this.releaseOnPageHide);
  }

  async dispose() {
    this.disposed = true;
    if (this.heartbeatHandle !== undefined) {
      window.clearInterval(this.heartbeatHandle);
    }
    window.removeEventListener("pagehide", this.releaseOnPageHide);
    await this.releaseLock();
  }

  private readonly releaseOnPageHide = () => {
    if (!this.projectId) return;
    ServerProjectManager.unlockProjectKeepalive(this.projectId);
  };

  private async renewLock() {
    if (!this.projectId || this.disposed) return;
    try {
      await ServerProjectManager.lockProject(this.projectId);
    } catch (error) {
      toast.error(`服务器项目锁续期失败：${String(error)}`);
    }
  }

  private async releaseLock() {
    if (!this.projectId) return;
    try {
      await ServerProjectManager.unlockProject(this.projectId);
    } catch (error) {
      console.warn("释放服务器项目锁失败:", error, this.project.uri.toString());
    }
  }
}
