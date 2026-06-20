import type { Project } from "@/core/Project";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import { URI } from "vscode-uri";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRuntimeActions } from "./ProjectRuntimeActions";

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
  } as unknown as Project;
}

describe("ProjectRuntimeActions", () => {
  afterEach(() => {
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
      importFolderToStage: false,
      exportBlob: false,
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
    await expect(ProjectRuntimeActions.importFolderToStage(project, "tree")).rejects.toMatchObject({
      detail: {
        action: "importFolderToStage",
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
      scanFolderForStage: false,
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
      importFolderToStage: false,
    });
  });

  it("reports visible unsupported errors for server-owned file menu actions in Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.spyOn(ServerProjectManager, "getServerInfo").mockResolvedValue(serverInfo({ backup: true }));
    const project = fakeProject(ServerProjectManager.projectUri("project-1"));

    await expect(ProjectRuntimeActions.importFolderToStage(project, "section")).rejects.toMatchObject({
      code: "unsupported_project_action",
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
