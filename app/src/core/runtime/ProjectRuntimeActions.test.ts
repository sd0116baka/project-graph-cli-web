import type { Project } from "@/core/Project";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { URI } from "vscode-uri";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRuntimeActions } from "./ProjectRuntimeActions";

const browserFileDialogMock = vi.hoisted(() => ({
  downloadBrowserBlob: vi.fn(),
  extensionAccept: vi.fn((extensions: string[]) => extensions.map((extension) => `.${extension}`).join(",")),
  pickBrowserDirectory: vi.fn(),
  pickBrowserFiles: vi.fn(),
}));

const stageFileImportServiceMock = vi.hoisted(() => ({
  importBrowserFiles: vi.fn(),
  textFileExtensions: vi.fn(() => ["txt", "md"]),
}));

const textFileImporterMock = vi.hoisted(() => ({
  importTextFilesFromFiles: vi.fn(),
}));

const tauriDialogMock = vi.hoisted(() => ({
  moduleLoads: 0,
  save: vi.fn(),
}));

const tauriFsMock = vi.hoisted(() => ({
  moduleLoads: 0,
  writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => {
  tauriDialogMock.moduleLoads++;
  return {
    save: tauriDialogMock.save,
  };
});

vi.mock("@tauri-apps/plugin-fs", () => {
  tauriFsMock.moduleLoads++;
  return {
    writeFile: tauriFsMock.writeFile,
  };
});

vi.mock("@/utils/browserFileDialog", () => browserFileDialogMock);

vi.mock("@/core/service/dataManageService/StageFileImportService", () => ({
  StageFileImportService: stageFileImportServiceMock,
}));

vi.mock("@/core/service/dataGenerateService/TextFileImporter", () => ({
  TextFileImporter: textFileImporterMock,
}));

function serverInfo(capabilities: Record<string, boolean> = {}): ServerProjectManager.ServerInfo {
  return {
    ok: true,
    host: "127.0.0.1",
    port: 37820,
    dataDirName: "data",
    staticDirName: "static",
    customDataDir: false,
    staticEnabled: true,
    authEnabled: false,
    allowedOrigin: "*",
    capabilities,
    serverUrl: "http://127.0.0.1:37820",
    clientName: "test",
  };
}

function fakeProject(uri: URI, content = new Uint8Array([1, 2, 3])): Project {
  return {
    uri,
    getFileContent: vi.fn().mockResolvedValue(content),
    generateFromFolder: {
      generateFromFolderEntry: vi.fn().mockResolvedValue(undefined),
      generateTreeFromFolderEntry: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Project;
}

describe("ProjectRuntimeActions", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("routes server project backups through the backend API", async () => {
    const content = new Uint8Array([4, 5, 6]);
    const project = fakeProject(ServerProjectManager.projectUri("project-1"), content);
    const getServerInfo = vi
      .spyOn(ServerProjectManager, "getServerInfo")
      .mockResolvedValue(serverInfo({ backup: true }));
    const createProjectBackup = vi.spyOn(ServerProjectManager, "createProjectBackup").mockResolvedValue({
      revision: "2026-06-20T00-00-00-000Z.prg",
      size: content.byteLength,
      createdAt: "2026-06-20T00:00:00.000Z",
    });

    const result = await ProjectRuntimeActions.createBackup(project);

    expect(getServerInfo).toHaveBeenCalledOnce();
    expect(project.getFileContent).toHaveBeenCalledWith({ includeThumbnail: false });
    expect(createProjectBackup).toHaveBeenCalledWith("project-1", content);
    expect(result).toMatchObject({
      runtime: "server",
      revision: "2026-06-20T00-00-00-000Z.prg",
      size: content.byteLength,
      createdAt: "2026-06-20T00:00:00.000Z",
    });
  });

  it("reports a visible capability error before calling a disabled server backup endpoint", async () => {
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));
    vi.spyOn(ServerProjectManager, "getServerInfo").mockResolvedValue(serverInfo({ backup: false }));
    const createProjectBackup = vi.spyOn(ServerProjectManager, "createProjectBackup");

    await expect(ProjectRuntimeActions.createBackup(project)).rejects.toMatchObject({
      code: "server_capability_unavailable",
      recovery: "请升级或重启 Project Graph 后端后重试。",
    });
    expect(createProjectBackup).not.toHaveBeenCalled();
  });

  it("uses the browser adapter for non-server projects outside Tauri", async () => {
    const project = fakeProject(URI.file("C:/projects/local.prg"));

    const actions = ProjectRuntimeActions.resolve(project);

    expect(actions.kind).toBe("browser");
    await expect(actions.capabilities(project)).resolves.toMatchObject({
      backup: false,
      saveAs: false,
      importFilesToStage: true,
      importFolderToStage: true,
      exportBlob: true,
      scanFolderForStage: true,
    });
    const backup = ProjectRuntimeActions.createBackup(project);
    expect(backup).toBeInstanceOf(Promise);
    await expect(backup).rejects.toMatchObject({
      code: "unsupported_project_action",
      recovery: "这个入口会在后续 Project Runtime Adapter 迁移中接入。",
    });
    await expect(ProjectRuntimeActions.saveAs(project)).rejects.toMatchObject({
      detail: {
        action: "saveAs",
        runtime: "browser",
      },
    });
    await expect(ProjectRuntimeActions.revealProjectLocation(project)).rejects.toMatchObject({
      detail: {
        action: "revealProjectLocation",
        runtime: "browser",
      },
    });
  });

  it("uses the Tauri adapter for local projects in Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const project = fakeProject(URI.file("C:/projects/local.prg"));

    const actions = ProjectRuntimeActions.resolve(project);

    expect(actions.kind).toBe("tauri");
    await expect(actions.capabilities(project)).resolves.toMatchObject({
      backup: false,
      saveAs: true,
      revealProjectLocation: true,
      importFilesToStage: true,
      importFolderToStage: true,
      exportBlob: true,
      scanFolderForStage: true,
    });
    const backup = ProjectRuntimeActions.createBackup(project);
    expect(backup).toBeInstanceOf(Promise);
    await expect(backup).rejects.toMatchObject({
      code: "unsupported_project_action",
    });
  });

  it("prefers the server adapter for server projects in Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.spyOn(ServerProjectManager, "getServerInfo").mockResolvedValue(serverInfo({ backup: true }));
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    const actions = ProjectRuntimeActions.resolve(project);

    expect(actions.kind).toBe("server");
    await expect(actions.capabilities(project)).resolves.toMatchObject({
      backup: true,
      saveAs: false,
      revealProjectLocation: false,
      importFolderToStage: false,
    });
    await expect(ProjectRuntimeActions.saveAs(project)).rejects.toMatchObject({
      detail: {
        action: "saveAs",
        runtime: "server",
      },
    });
    await expect(ProjectRuntimeActions.revealProjectLocation(project)).rejects.toMatchObject({
      detail: {
        action: "revealProjectLocation",
        runtime: "server",
      },
    });
  });

  it("uses browser file exchange actions for server projects outside Tauri", async () => {
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    expect(ProjectRuntimeActions.resolve(project).kind).toBe("server");
    expect(ProjectRuntimeActions.resolveForFileExchange(project).kind).toBe("browser");
    await expect(ProjectRuntimeActions.resolveForFileExchange(project).capabilities(project)).resolves.toMatchObject({
      importFilesToStage: true,
      importFolderToStage: true,
      exportBlob: true,
      scanFolderForStage: true,
    });
  });

  it("keeps browser menu import, export, and backup actions away from Tauri modules", async () => {
    tauriDialogMock.moduleLoads = 0;
    tauriFsMock.moduleLoads = 0;
    const imageFile = new File(["image"], "cover.png", { type: "image/png" });
    browserFileDialogMock.pickBrowserFiles.mockResolvedValue([imageFile]);
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    await ProjectRuntimeActions.importFilesToStage(project, "image");

    expect(browserFileDialogMock.pickBrowserFiles).toHaveBeenCalledWith({
      accept: ".png,.jpg,.jpeg,.webp",
      multiple: true,
    });
    expect(stageFileImportServiceMock.importBrowserFiles).toHaveBeenCalledWith(project, [imageFile]);

    const exportedBlob = new Blob(["<svg />"], { type: "image/svg+xml" });
    const exportResult = await ProjectRuntimeActions.exportBlob(project, exportedBlob, "graph.svg");

    expect(exportResult).toEqual({ runtime: "browser", status: "exported" });
    expect(browserFileDialogMock.downloadBrowserBlob).toHaveBeenCalledWith(exportedBlob, "graph.svg");
    await expect(
      ProjectRuntimeActions.createBackup(fakeProject(URI.file("C:/projects/local.prg"))),
    ).rejects.toMatchObject({
      detail: {
        action: "createBackup",
        runtime: "browser",
      },
    });
    expect(tauriDialogMock.moduleLoads).toBe(0);
    expect(tauriFsMock.moduleLoads).toBe(0);
    expect(tauriDialogMock.save).not.toHaveBeenCalled();
    expect(tauriFsMock.writeFile).not.toHaveBeenCalled();
  });

  it("routes server folder imports through the backend folder scanner", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const folderStructure: ServerProjectManager.FolderEntry = {
      name: "repo",
      path: "C:/repo",
      is_file: false,
      children: [{ name: "README.md", path: "C:/repo/README.md", is_file: true }],
    };
    vi.spyOn(ServerProjectManager, "getServerInfo").mockResolvedValue(serverInfo({ backup: true, folderScan: true }));
    const scanServerFolder = vi.spyOn(ServerProjectManager, "scanServerFolder").mockResolvedValue(folderStructure);
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "C:/repo"),
    );
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    await ProjectRuntimeActions.importFolderToStage(project, "tree");

    expect(scanServerFolder).toHaveBeenCalledWith("C:/repo");
    expect(project.generateFromFolder.generateTreeFromFolderEntry).toHaveBeenCalledWith(folderStructure);
    expect(project.generateFromFolder.generateFromFolderEntry).not.toHaveBeenCalled();
  });

  it("builds stable folder entries from browser directory files", () => {
    const readme = browserDirectoryFile("README.md", "repo/README.md");
    const index = browserDirectoryFile("index.ts", "repo/src/index.ts");
    const nested = browserDirectoryFile("note.md", "repo/src/nested/note.md");

    const root = ProjectRuntimeActions.folderEntryFromBrowserFiles([readme, nested, index]);

    expect(root).toEqual({
      name: "repo",
      path: "repo",
      is_file: false,
      children: [
        {
          name: "src",
          path: "repo/src",
          is_file: false,
          children: [
            {
              name: "nested",
              path: "repo/src/nested",
              is_file: false,
              children: [{ name: "note.md", path: "repo/src/nested/note.md", is_file: true }],
            },
            { name: "index.ts", path: "repo/src/index.ts", is_file: true },
          ],
        },
        { name: "README.md", path: "repo/README.md", is_file: true },
      ],
    });
  });

  it("builds a browser-files root when files do not have directory paths", () => {
    const root = ProjectRuntimeActions.folderEntryFromBrowserFiles([new File(["a"], "a.txt")]);

    expect(root).toEqual({
      name: "browser-files",
      path: "browser-files",
      is_file: false,
      children: [{ name: "a.txt", path: "browser-files/a.txt", is_file: true }],
    });
  });

  it("uses the Tauri export action for server projects in Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const saveMock = vi.mocked(save);
    const writeFileMock = vi.mocked(writeFile);
    saveMock.mockResolvedValue("C:/exports/test.png");
    writeFileMock.mockResolvedValue(undefined);
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    const result = await ProjectRuntimeActions.exportBlob(
      project,
      new Blob([new Uint8Array([7, 8])], { type: "image/png" }),
      "test.png",
    );

    expect(result).toEqual({ runtime: "tauri", status: "exported" });
    expect(saveMock).toHaveBeenCalledWith({
      title: "导出文件",
      defaultPath: "test.png",
      filters: [{ name: "Portable Network Graphics", extensions: ["png"] }],
    });
    expect(writeFileMock).toHaveBeenCalledWith("C:/exports/test.png", expect.any(Uint8Array));
    expect(Array.from(writeFileMock.mock.calls[0][1] as Uint8Array)).toEqual([7, 8]);
  });

  it("reports cancelled Tauri exports without writing files", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const saveMock = vi.mocked(save);
    const writeFileMock = vi.mocked(writeFile);
    saveMock.mockResolvedValue(null);
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    const result = await ProjectRuntimeActions.exportBlob(project, new Blob(["cancel"]), "test.png");

    expect(result).toEqual({ runtime: "tauri", status: "cancelled" });
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("reports visible unsupported errors for server-owned file menu actions in Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.spyOn(ServerProjectManager, "getServerInfo").mockResolvedValue(serverInfo({ backup: true }));
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    await expect(ProjectRuntimeActions.importFolderToStage(project, "section")).rejects.toMatchObject({
      code: "server_capability_unavailable",
      detail: {
        action: "importFolderToStage",
        runtime: "server",
      },
    });
    await expect(ProjectRuntimeActions.importFilesToStage(project, "image")).rejects.toMatchObject({
      detail: {
        action: "importFilesToStage",
        runtime: "server",
      },
    });
  });
});

function browserDirectoryFile(name: string, relativePath: string): File {
  const file = new File(["content"], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}
