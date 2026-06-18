import { Dialog } from "@/components/ui/dialog";
import type { FileSystemProvider } from "@/core/interfaces/Service";
import { ServerProjectManager } from "@/core/service/dataFileService/ServerProjectManager";
import type { DirEntry } from "@tauri-apps/plugin-fs";
import type { URI } from "vscode-uri";

export class FileSystemProviderServer implements FileSystemProvider {
  async read(uri: URI): Promise<Uint8Array> {
    return ServerProjectManager.readProjectBlob(ServerProjectManager.projectIdFromUri(uri));
  }

  async readDir(): Promise<DirEntry[]> {
    const projects = await ServerProjectManager.listProjects();
    return projects.map(
      (project) =>
        ({
          name: project.name,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          children: [],
        }) as DirEntry,
    );
  }

  async write(uri: URI, content: Uint8Array): Promise<void> {
    try {
      await ServerProjectManager.writeProjectBlob(ServerProjectManager.projectIdFromUri(uri), content);
    } catch (error) {
      void Dialog.buttons(
        "服务器项目保存失败",
        `${ServerProjectManager.formatError(error)}\n\n${ServerProjectManager.recoveryHint(error)}`,
        [{ id: "ok", label: "知道了" }],
      );
      throw error;
    }
  }

  async remove(uri: URI): Promise<void> {
    await ServerProjectManager.removeProject(ServerProjectManager.projectIdFromUri(uri));
  }

  async exists(uri: URI): Promise<boolean> {
    return ServerProjectManager.projectBlobExists(ServerProjectManager.projectIdFromUri(uri));
  }

  async mkdir(): Promise<void> {}

  async rename(): Promise<void> {
    throw new Error("服务器项目暂不支持重命名 URI");
  }
}
