import { Project } from "@/core/Project";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { StageFileImportService } from "@/core/service/dataManageService/StageFileImportService";
import { extensionAccept, pickBrowserFiles } from "@/utils/browserFileDialog";
import { isTauriRuntime } from "@/utils/runtime";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

export namespace TextFileImporter {
  const textFileExtensions = StageFileImportService.textFileExtensions();
  const previewFileExtensions = ["txt", "md", "markdown", "json", "csv"];

  export async function importTextFiles(project: Project): Promise<number> {
    if (!isTauriRuntime()) {
      const files = await pickBrowserFiles({
        accept: extensionAccept(textFileExtensions),
        multiple: true,
      });
      return importTextFilesFromFiles(project, files);
    }

    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const pathList = await open({
      title: "选择文本文件",
      directory: false,
      multiple: true,
      filters: [
        {
          name: "文本文件",
          extensions: [
            "txt",
            "md",
            "markdown",
            "json",
            "csv",
            "xml",
            "html",
            "css",
            "js",
            "ts",
            "tsx",
            "jsx",
            "py",
            "java",
            "c",
            "cpp",
            "h",
            "hpp",
            "go",
            "rs",
            "rb",
            "php",
            "sql",
            "sh",
            "bat",
            "yaml",
            "yml",
            "toml",
            "ini",
            "conf",
            "log",
          ],
        },
      ],
    });

    if (!pathList) {
      return 0;
    }

    const paths = Array.isArray(pathList) ? pathList : [pathList];
    let importedCount = 0;

    const startX = 100;
    const startY = 100;
    const nodeWidth = 300;
    const nodeHeight = 150;
    const horizontalGap = 50;
    const verticalGap = 50;
    const nodesPerRow = 4;

    try {
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const content = await readFile(path);
        const text = new TextDecoder().decode(content);
        const fileName = path.split(/[/\\]/).pop() || "未命名";

        addTextFileNode(project, fileName, text, importedCount, {
          startX,
          startY,
          nodeWidth,
          nodeHeight,
          horizontalGap,
          verticalGap,
          nodesPerRow,
        });
        importedCount++;
      }
    } catch (error) {
      if (importedCount > 0) {
        project.historyManager.recordStep();
      }
      throw error;
    }

    if (importedCount > 0) {
      project.historyManager.recordStep();
    }

    return importedCount;
  }

  export async function importTextFilesFromFiles(project: Project, files: File[]): Promise<number> {
    for (const file of files) {
      StageFileImportService.assertBrowserFileSize(file);
    }

    let importedCount = 0;
    const layout = {
      startX: 100,
      startY: 100,
      nodeWidth: 300,
      nodeHeight: 150,
      horizontalGap: 50,
      verticalGap: 50,
      nodesPerRow: 4,
    };

    try {
      for (const file of files) {
        addTextFileNode(project, file.name || "未命名", await file.text(), importedCount, layout);
        importedCount++;
      }
    } catch (error) {
      if (importedCount > 0) {
        project.historyManager.recordStep();
      }
      throw error;
    }

    if (importedCount > 0) {
      project.historyManager.recordStep();
    }
    return importedCount;
  }

  export async function getTextFileContent(): Promise<{ fileName: string; content: string } | null> {
    if (!isTauriRuntime()) {
      const files = await pickBrowserFiles({
        accept: extensionAccept(previewFileExtensions),
        multiple: false,
      });
      const file = files[0];
      if (!file) return null;
      StageFileImportService.assertBrowserFileSize(file);
      return { fileName: file.name || "未命名", content: await file.text() };
    }

    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const pathList = await open({
      title: "选择文本文件",
      directory: false,
      multiple: false,
      filters: [
        {
          name: "文本文件",
          extensions: ["txt", "md", "markdown", "json", "csv"],
        },
      ],
    });

    if (!pathList) {
      return null;
    }

    const path = Array.isArray(pathList) ? pathList[0] : pathList;

    const content = await readFile(path);
    const text = new TextDecoder().decode(content);
    const fileName = path.split(/[/\\]/).pop() || "未命名";

    return { fileName, content: text };
  }

  function addTextFileNode(
    project: Project,
    fileName: string,
    text: string,
    index: number,
    layout: {
      startX: number;
      startY: number;
      nodeWidth: number;
      nodeHeight: number;
      horizontalGap: number;
      verticalGap: number;
      nodesPerRow: number;
    },
  ): void {
    const row = Math.floor(index / layout.nodesPerRow);
    const col = index % layout.nodesPerRow;
    const x = layout.startX + col * (layout.nodeWidth + layout.horizontalGap);
    const y = layout.startY + row * (layout.nodeHeight + layout.verticalGap);

    const node = new TextNode(project, {
      text: `【${fileName}】\n\n${text.slice(0, 2000)}${text.length > 2000 ? "..." : ""}`,
      color: new Color(0, 0, 0, 0),
      collisionBox: new CollisionBox([
        new Rectangle(new Vector(x, y), new Vector(layout.nodeWidth, layout.nodeHeight)),
      ]),
      sizeAdjust: "manual",
    });

    project.stageManager.add(node);
  }
}
