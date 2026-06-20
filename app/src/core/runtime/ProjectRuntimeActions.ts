import type { Project } from "@/core/Project";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { isTauriRuntime } from "@/utils/runtime";
import { URI } from "vscode-uri";

export namespace ProjectRuntimeActions {
  export type RuntimeKind = "tauri" | "server" | "browser";

  export type ImportFileKind = "image" | "svg" | "text";

  export type FolderImportMode = "section" | "tree";

  export type FolderSource =
    | { kind: "tauri-path"; path: string }
    | { kind: "server-path"; path: string }
    | { kind: "browser-files"; files: File[] };

  export type FolderEntry = ServerProjectManager.FolderEntry;

  export type ProjectBackupResult = {
    runtime: RuntimeKind;
    revision?: string;
    size?: number;
    createdAt?: string;
  };

  export type ProjectExportResult = {
    runtime: RuntimeKind;
    status: "exported" | "cancelled";
  };

  export type ProjectRuntimeCapabilities = {
    backup: boolean;
    saveAs: boolean;
    revealProjectLocation: boolean;
    importFilesToStage: boolean;
    importFolderToStage: boolean;
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
    importFolderToStage(context: ProjectActionContext, mode: FolderImportMode): Promise<void>;
    exportBlob(context: ProjectActionContext, blob: Blob, suggestedName: string): Promise<ProjectExportResult>;
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

  export function resolveForFileExchange(project: Project): ProjectRuntimeActionSet {
    if (!isTauriRuntime()) {
      return browserProjectActions;
    }
    return resolve(project);
  }

  export function resolveForBlobExport(): ProjectRuntimeActionSet {
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

  export async function saveAs(project: Project): Promise<void> {
    return resolve(project).saveAs({ project });
  }

  export async function revealProjectLocation(project: Project): Promise<void> {
    return resolve(project).revealProjectLocation({ project });
  }

  export async function importFilesToStage(project: Project, kind: ImportFileKind): Promise<void> {
    return resolveForFileExchange(project).importFilesToStage({ project }, kind);
  }

  export async function importFolderToStage(project: Project, mode: FolderImportMode): Promise<void> {
    return resolveForFileExchange(project).importFolderToStage({ project }, mode);
  }

  export async function exportBlob(project: Project, blob: Blob, suggestedName: string): Promise<ProjectExportResult> {
    return resolveForBlobExport().exportBlob({ project }, blob, suggestedName);
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

  export function isRuntimeActionError(error: unknown): error is ProjectRuntimeActionError {
    return error instanceof ProjectRuntimeActionError;
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
    importFilesToStage: unsupported(
      "server",
      "importFilesToStage",
      "服务器项目导入文件需要后端导入 API 或浏览器文件上传通道。",
    ),
    async importFolderToStage({ project }, mode) {
      await ensureServerCapability("importFolderToStage");
      const path = promptServerFolderPath();
      if (!path) return;
      const folderStructure = await scanServerFolderSource({ kind: "server-path", path });
      await applyFolderEntryToStage(project, mode, folderStructure);
    },
    exportBlob: unsupported("server", "exportBlob", "服务器项目导出还没有接入运行时适配层。"),
    async scanFolderForStage(_context, source) {
      await ensureServerCapability("scanFolderForStage");
      return scanServerFolderSource(source);
    },
  };

  const tauriProjectActions: ProjectRuntimeActionSet = {
    kind: "tauri",
    async capabilities() {
      return tauriCapabilities;
    },
    createBackup: unsupported("tauri", "createBackup", "本地项目备份仍由现有桌面备份流程处理。"),
    async saveAs({ project }) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { RecentFileManager } = await import("@/core/service/dataFileService/RecentFileManager");
      const path = await save({
        title: "另存为",
        filters: [{ name: "Project Graph", extensions: ["prg"] }],
      });
      if (!path) return;
      project.uri = URI.file(path);
      await RecentFileManager.addRecentFileByUri(project.uri);
      await project.save();
    },
    async revealProjectLocation({ project }) {
      if (!project.uri || project.isDraft || project.uri.scheme !== "file") {
        throw unsupportedError("tauri", "revealProjectLocation", "只有已保存的本地项目才能打开所在文件夹。");
      }
      const { open } = await import("@tauri-apps/plugin-shell");
      const { PathString } = await import("@/utils/pathString");
      await open(PathString.dirPath(project.uri.fsPath));
    },
    async importFilesToStage({ project }, kind) {
      if (kind === "text") {
        const { openTextImportWindow } = await import("@/sub/TextImportWindow");
        openTextImportWindow();
        return;
      }

      const { open } = await import("@tauri-apps/plugin-dialog");
      const { DragFileIntoStageEngine } =
        await import("@/core/service/dataManageService/dragFileIntoStageEngine/dragFileIntoStageEngine");
      const pathList = await open({
        title: "打开文件",
        directory: false,
        multiple: true,
        filters:
          kind === "image"
            ? [{ name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp"] }]
            : [{ name: "*", extensions: ["svg"] }],
      });
      if (!pathList) return;

      const paths = Array.isArray(pathList) ? pathList : [pathList];
      let importedCount = 0;
      for (const [index, path] of paths.entries()) {
        if (kind === "image") {
          await DragFileIntoStageEngine.handleDropImage(project, path, imageMimeFromPath(path), index);
        } else {
          await DragFileIntoStageEngine.handleDropSvg(project, path);
        }
        importedCount++;
      }
      if (importedCount > 0) {
        project.historyManager.recordStep();
      }
    },
    async importFolderToStage({ project }, mode) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        title: "打开文件夹",
        directory: true,
        multiple: false,
        filters: [],
      });
      if (!path || typeof path !== "string") return;
      const folderStructure = await tauriProjectActions.scanFolderForStage({ project }, { kind: "tauri-path", path });
      await applyFolderEntryToStage(project, mode, folderStructure);
    },
    async exportBlob(_context, blob, suggestedName) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        title: "导出文件",
        defaultPath: suggestedName,
        filters: exportFilters(suggestedName),
      });
      if (!path) return { runtime: "tauri", status: "cancelled" };
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      return { runtime: "tauri", status: "exported" };
    },
    async scanFolderForStage(_context, source) {
      if (source.kind !== "tauri-path") {
        throw unsupportedError("tauri", "scanFolderForStage", "桌面端文件夹扫描需要本机文件夹路径。");
      }
      const { readTauriFolderStructure } =
        await import("@/core/service/dataGenerateService/generateFromFolderEngine/GenerateFromFolderEngine");
      return readTauriFolderStructure(source.path);
    },
  };

  const browserProjectActions: ProjectRuntimeActionSet = {
    kind: "browser",
    async capabilities() {
      return browserCapabilities;
    },
    createBackup: unsupported("browser", "createBackup", unsupportedBrowserLocalBackupMessage),
    saveAs: unsupported("browser", "saveAs", "浏览器本地另存为还没有接入运行时适配层。"),
    revealProjectLocation: unsupported("browser", "revealProjectLocation", "浏览器不能打开本机项目所在文件夹。"),
    async importFilesToStage({ project }, kind) {
      const { extensionAccept, pickBrowserFiles } = await import("@/utils/browserFileDialog");
      if (kind === "text") {
        const { TextFileImporter } = await import("@/core/service/dataGenerateService/TextFileImporter");
        const { StageFileImportService } = await import("@/core/service/dataManageService/StageFileImportService");
        const files = await pickBrowserFiles({
          accept: extensionAccept(StageFileImportService.textFileExtensions()),
          multiple: true,
        });
        await TextFileImporter.importTextFilesFromFiles(project, files);
        return;
      }

      const { StageFileImportService } = await import("@/core/service/dataManageService/StageFileImportService");
      const files = await pickBrowserFiles({
        accept: kind === "image" ? extensionAccept(["png", "jpg", "jpeg", "webp"]) : "image/svg+xml,.svg",
        multiple: true,
      });
      await StageFileImportService.importBrowserFiles(project, files);
    },
    async importFolderToStage({ project }, mode) {
      const { pickBrowserDirectory } = await import("@/utils/browserFileDialog");
      const files = await pickBrowserDirectory();
      if (files.length === 0) return;
      const folderStructure = await browserProjectActions.scanFolderForStage(
        { project },
        { kind: "browser-files", files },
      );
      await applyFolderEntryToStage(project, mode, folderStructure);
    },
    async exportBlob(_context, blob, suggestedName) {
      const { downloadBrowserBlob } = await import("@/utils/browserFileDialog");
      downloadBrowserBlob(blob, suggestedName);
      return { runtime: "browser", status: "exported" };
    },
    async scanFolderForStage(_context, source) {
      if (source.kind !== "browser-files") {
        throw unsupportedError("browser", "scanFolderForStage", "浏览器文件夹扫描需要目录上传文件列表。");
      }
      return folderEntryFromBrowserFiles(source.files);
    },
  };

  const serverBaseCapabilities: ProjectRuntimeCapabilities = {
    backup: true,
    saveAs: false,
    revealProjectLocation: false,
    importFilesToStage: false,
    importFolderToStage: false,
    exportBlob: false,
    scanFolderForStage: false,
  };

  const tauriCapabilities: ProjectRuntimeCapabilities = {
    backup: false,
    saveAs: true,
    revealProjectLocation: true,
    importFilesToStage: true,
    importFolderToStage: true,
    exportBlob: true,
    scanFolderForStage: true,
  };

  const browserCapabilities: ProjectRuntimeCapabilities = {
    backup: false,
    saveAs: false,
    revealProjectLocation: false,
    importFilesToStage: true,
    importFolderToStage: true,
    exportBlob: true,
    scanFolderForStage: true,
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
    return (() => Promise.reject(unsupportedError(runtime, action, message))) as ProjectRuntimeActionSet[TAction];
  }

  function unsupportedError<TAction extends ProjectRuntimeActionName>(
    runtime: RuntimeKind,
    action: TAction,
    message: string,
  ): ProjectRuntimeActionError {
    return new ProjectRuntimeActionError({
      code: "unsupported_project_action",
      action,
      runtime,
      message,
      recovery: "这个入口会在后续 Project Runtime Adapter 迁移中接入。",
    });
  }

  async function readServerCapabilities(): Promise<ProjectRuntimeCapabilities> {
    const info = await ServerProjectManager.getServerInfo();
    const folderScan = info.capabilities?.scanFolderForStage ?? info.capabilities?.folderScan ?? false;
    return {
      ...serverBaseCapabilities,
      backup: info.capabilities?.backup ?? true,
      importFolderToStage: folderScan,
      scanFolderForStage: folderScan,
    };
  }

  function capabilityToAction(capability: keyof ProjectRuntimeCapabilities): ProjectRuntimeActionName {
    if (capability === "backup") return "createBackup";
    return capability;
  }

  function imageMimeFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    return "image/png";
  }

  function exportFilters(suggestedName: string): { name: string; extensions: string[] }[] {
    const ext = suggestedName.split(".").pop()?.toLowerCase();
    if (ext === "svg") return [{ name: "Scalable Vector Graphics", extensions: ["svg"] }];
    if (ext === "png") return [{ name: "Portable Network Graphics", extensions: ["png"] }];
    return [{ name: "文件", extensions: ext ? [ext] : [] }];
  }

  async function applyFolderEntryToStage(
    project: Project,
    mode: FolderImportMode,
    folderStructure: FolderEntry,
  ): Promise<void> {
    if (mode === "section") {
      await project.generateFromFolder.generateFromFolderEntry(folderStructure);
    } else {
      await project.generateFromFolder.generateTreeFromFolderEntry(folderStructure);
    }
  }

  async function scanServerFolderSource(source: FolderSource): Promise<FolderEntry> {
    if (source.kind !== "server-path") {
      throw unsupportedError("server", "scanFolderForStage", "服务器项目只能扫描后端机器上的文件夹路径。");
    }
    return ServerProjectManager.scanServerFolder(source.path);
  }

  function promptServerFolderPath(): string | undefined {
    const path = globalThis.prompt?.("输入后端机器上的文件夹路径")?.trim();
    return path || undefined;
  }

  export function folderEntryFromBrowserFiles(files: File[]): FolderEntry {
    const paths = files.map((file) => browserRelativePath(file)).filter(Boolean);
    const firstSegments = new Set(paths.map((path) => path.split(/[\\/]/).filter(Boolean)[0]).filter(Boolean));
    const hasSingleRoot =
      firstSegments.size === 1 && paths.every((path) => path.split(/[\\/]/).filter(Boolean).length > 1);
    const rootName = hasSingleRoot ? [...firstSegments][0]! : "browser-files";
    const root: FolderEntry = { name: rootName, path: rootName, is_file: false, children: [] };

    for (const file of files) {
      const parts = browserRelativePath(file).split(/[\\/]/).filter(Boolean);
      appendBrowserFile(root, hasSingleRoot ? parts.slice(1) : parts);
    }

    sortFolderEntry(root);
    return root;
  }

  function appendBrowserFile(root: FolderEntry, parts: string[]): void {
    if (parts.length === 0) return;
    let current = root;
    for (const part of parts.slice(0, -1)) {
      current.children ??= [];
      let child = current.children.find((entry) => !entry.is_file && entry.name === part);
      if (!child) {
        child = {
          name: part,
          path: `${current.path}/${part}`,
          is_file: false,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    current.children ??= [];
    const fileName = parts[parts.length - 1]!;
    current.children.push({
      name: fileName,
      path: `${current.path}/${fileName}`,
      is_file: true,
    });
  }

  function sortFolderEntry(entry: FolderEntry): void {
    entry.children?.sort((a, b) => Number(a.is_file) - Number(b.is_file) || a.name.localeCompare(b.name));
    for (const child of entry.children ?? []) {
      sortFolderEntry(child);
    }
  }

  function browserRelativePath(file: File): string {
    return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  }
}
