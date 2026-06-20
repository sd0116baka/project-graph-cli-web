import type { Project } from "@/core/Project";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { isTauriRuntime } from "@/utils/runtime";

export namespace ProjectRuntimeActions {
  export type RuntimeKind = "tauri" | "server" | "browser";

  export type ImportFileKind = "image" | "svg" | "text";

  export type FolderSource =
    | { kind: "tauri-path"; path: string }
    | { kind: "server-path"; path: string }
    | { kind: "browser-files"; files: File[] };

  export type FolderEntry = {
    name: string;
    path: string;
    kind: "file" | "directory";
    children?: FolderEntry[];
  };

  export type ProjectBackupResult = {
    runtime: RuntimeKind;
    revision?: string;
    size?: number;
    createdAt?: string;
  };

  export type ProjectRuntimeCapabilities = {
    backup: boolean;
    saveAs: boolean;
    revealProjectLocation: boolean;
    importFilesToStage: boolean;
    exportBlob: boolean;
    scanFolderForStage: boolean;
  };

  export type ProjectActionContext = {
    project: Project;
  };

  export type ProjectRuntimeActionSet = {
    kind: RuntimeKind;
    capabilities(project: Project): Promise<ProjectRuntimeCapabilities>;
    createBackup(context: ProjectActionContext): Promise<ProjectBackupResult>;
    saveAs(context: ProjectActionContext): Promise<void>;
    revealProjectLocation(context: ProjectActionContext): Promise<void>;
    importFilesToStage(context: ProjectActionContext, kind: ImportFileKind): Promise<void>;
    exportBlob(context: ProjectActionContext, blob: Blob, suggestedName: string): Promise<void>;
    scanFolderForStage(context: ProjectActionContext, source: FolderSource): Promise<FolderEntry>;
  };

  export type ProjectRuntimeActionName = Exclude<keyof ProjectRuntimeActionSet, "kind" | "capabilities">;

  export type ProjectRuntimeActionErrorDetail = {
    code: "unsupported_project_action" | "server_capability_unavailable";
    action: ProjectRuntimeActionName;
    runtime: RuntimeKind;
    message: string;
    recovery: string;
  };

  export class ProjectRuntimeActionError extends Error {
    constructor(readonly detail: ProjectRuntimeActionErrorDetail) {
      super(detail.message);
      this.name = "ProjectRuntimeActionError";
    }

    get code(): ProjectRuntimeActionErrorDetail["code"] {
      return this.detail.code;
    }

    get recovery(): string {
      return this.detail.recovery;
    }
  }

  const unsupportedBrowserLocalBackupMessage = "浏览器端仅支持备份服务器项目；本地项目需要在桌面端备份。";

  export function resolve(project: Project): ProjectRuntimeActionSet {
    if (project.uri?.scheme === "server") {
      return serverProjectActions;
    }
    if (isTauriRuntime()) {
      return tauriProjectActions;
    }
    return browserProjectActions;
  }

  export function canUseLocalProjectFileSystem(project: Project): boolean {
    return resolve(project).kind === "tauri";
  }

  export async function createBackup(project: Project): Promise<ProjectBackupResult> {
    return resolve(project).createBackup({ project });
  }

  export function formatError(error: unknown): string {
    if (error instanceof ProjectRuntimeActionError) {
      return error.message;
    }
    return ServerProjectManager.formatError(error);
  }

  export function recoveryHint(error: unknown): string {
    if (error instanceof ProjectRuntimeActionError) {
      return error.recovery;
    }
    return ServerProjectManager.recoveryHint(error);
  }

  const serverProjectActions: ProjectRuntimeActionSet = {
    kind: "server",
    async capabilities() {
      return readServerCapabilities();
    },
    async createBackup({ project }) {
      await ensureServerCapability("backup");
      const projectId = ServerProjectManager.projectIdFromUri(project.uri);
      const fileContent = await project.getFileContent({ includeThumbnail: false });
      const backup = await ServerProjectManager.createProjectBackup(projectId, fileContent);
      return {
        runtime: "server",
        revision: backup.revision,
        size: backup.size,
        createdAt: backup.createdAt,
      };
    },
    saveAs: unsupported("server", "saveAs", "服务器项目另存为还没有接入运行时适配层。"),
    revealProjectLocation: unsupported(
      "server",
      "revealProjectLocation",
      "服务器项目的位置在后端机器上，不能直接打开本机文件夹。",
    ),
    importFilesToStage: unsupported("server", "importFilesToStage", "服务器项目导入文件还没有接入运行时适配层。"),
    exportBlob: unsupported("server", "exportBlob", "服务器项目导出还没有接入运行时适配层。"),
    scanFolderForStage: unsupported("server", "scanFolderForStage", "服务器项目文件夹扫描需要后端 API。"),
  };

  const tauriProjectActions: ProjectRuntimeActionSet = {
    kind: "tauri",
    async capabilities() {
      return tauriCapabilities;
    },
    createBackup: unsupported("tauri", "createBackup", "本地项目备份仍由现有桌面备份流程处理。"),
    saveAs: unsupported("tauri", "saveAs", "本地项目另存为还没有接入运行时适配层。"),
    revealProjectLocation: unsupported("tauri", "revealProjectLocation", "打开项目位置还没有接入运行时适配层。"),
    importFilesToStage: unsupported("tauri", "importFilesToStage", "本地项目导入文件还没有接入运行时适配层。"),
    exportBlob: unsupported("tauri", "exportBlob", "本地项目导出还没有接入运行时适配层。"),
    scanFolderForStage: unsupported("tauri", "scanFolderForStage", "本地项目文件夹扫描还没有接入运行时适配层。"),
  };

  const browserProjectActions: ProjectRuntimeActionSet = {
    kind: "browser",
    async capabilities() {
      return browserCapabilities;
    },
    createBackup: unsupported("browser", "createBackup", unsupportedBrowserLocalBackupMessage),
    saveAs: unsupported("browser", "saveAs", "浏览器本地另存为还没有接入运行时适配层。"),
    revealProjectLocation: unsupported("browser", "revealProjectLocation", "浏览器不能打开本机项目所在文件夹。"),
    importFilesToStage: unsupported("browser", "importFilesToStage", "浏览器导入文件还没有接入运行时适配层。"),
    exportBlob: unsupported("browser", "exportBlob", "浏览器导出还没有接入运行时适配层。"),
    scanFolderForStage: unsupported("browser", "scanFolderForStage", "浏览器文件夹扫描还没有接入运行时适配层。"),
  };

  const serverBaseCapabilities: ProjectRuntimeCapabilities = {
    backup: true,
    saveAs: false,
    revealProjectLocation: false,
    importFilesToStage: false,
    exportBlob: false,
    scanFolderForStage: false,
  };

  const tauriCapabilities: ProjectRuntimeCapabilities = {
    backup: false,
    saveAs: false,
    revealProjectLocation: false,
    importFilesToStage: false,
    exportBlob: false,
    scanFolderForStage: false,
  };

  const browserCapabilities: ProjectRuntimeCapabilities = {
    backup: false,
    saveAs: false,
    revealProjectLocation: false,
    importFilesToStage: false,
    exportBlob: false,
    scanFolderForStage: false,
  };

  async function ensureServerCapability(capability: keyof ProjectRuntimeCapabilities): Promise<void> {
    const capabilities = await readServerCapabilities();
    if (capabilities[capability]) {
      return;
    }
    throw new ProjectRuntimeActionError({
      code: "server_capability_unavailable",
      action: capabilityToAction(capability),
      runtime: "server",
      message: `当前后端不支持项目${capability}能力。`,
      recovery: "请升级或重启 Project Graph 后端后重试。",
    });
  }

  function unsupported<TAction extends ProjectRuntimeActionName>(
    runtime: RuntimeKind,
    action: TAction,
    message: string,
  ): ProjectRuntimeActionSet[TAction] {
    return (() =>
      Promise.reject(
        new ProjectRuntimeActionError({
          code: "unsupported_project_action",
          action,
          runtime,
          message,
          recovery: "这个入口会在后续 Project Runtime Adapter 迁移中接入。",
        }),
      )) as ProjectRuntimeActionSet[TAction];
  }

  async function readServerCapabilities(): Promise<ProjectRuntimeCapabilities> {
    const info = await ServerProjectManager.getServerInfo();
    return {
      ...serverBaseCapabilities,
      backup: info.capabilities?.backup ?? true,
    };
  }

  function capabilityToAction(capability: keyof ProjectRuntimeCapabilities): ProjectRuntimeActionName {
    if (capability === "backup") return "createBackup";
    return capability;
  }
}
