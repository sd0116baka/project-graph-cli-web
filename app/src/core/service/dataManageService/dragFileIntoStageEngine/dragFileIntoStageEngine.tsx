import { Project } from "@/core/Project";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { DetailsManager } from "@/core/stage/stageObject/tools/entityDetailsManager";
import { PathString } from "@/utils/pathString";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { readFile, stat } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { URI } from "vscode-uri";
import { onOpenFile } from "../../GlobalMenu";
import { Settings } from "@/core/service/Settings";
import { StageFileImportService } from "../StageFileImportService";

/**
 * 处理文件拖拽到舞台的引擎
 */
export namespace DragFileIntoStageEngine {
  /**
   * 处理文件拖拽到舞台，对各种类型的文件分类讨论
   * @param project 当前活动的项目
   * @param pathList 拖拽的文件路径列表
   */
  export async function handleDrop(project: Project, pathList: string[]) {
    try {
      const imageTypeSet = new Set(["png", "jpg", "jpeg", "webp"]);
      const imagePaths: string[] = [];
      for (const filePath of pathList) {
        const extName = filePath.split(".").pop()?.toLowerCase() ?? "";
        if (imageTypeSet.has(extName)) {
          imagePaths.push(filePath);
        }
      }

      const sortedImagePaths = await sortFileList(imagePaths);

      let imageIndex = 0;
      let importedCount = 0;
      for (const filePath of pathList) {
        const extName = filePath.split(".").pop()?.toLowerCase();
        if (extName === "png") {
          await handleDropImage(project, sortedImagePaths[imageIndex], "image/png", imageIndex);
          imageIndex++;
          importedCount++;
        } else if (extName === "jpg" || extName === "jpeg") {
          await handleDropImage(project, sortedImagePaths[imageIndex], "image/jpeg", imageIndex);
          imageIndex++;
          importedCount++;
        } else if (extName === "webp") {
          await handleDropImage(project, sortedImagePaths[imageIndex], "image/webp", imageIndex);
          imageIndex++;
          importedCount++;
        } else if (extName === "txt") {
          await handleDropTxt(project, filePath);
          importedCount++;
        } else if (extName === "svg") {
          await handleDropSvg(project, filePath);
          importedCount++;
        } else if (extName === "prg") {
          const uri = URI.file(filePath);
          onOpenFile(uri, "拖拽prg文件到舞台");
        } else {
          toast.error(`不支持的文件类型: 【${extName}】`);
        }
      }
      if (importedCount > 0) {
        project.historyManager.recordStep();
      }
    } catch (error) {
      toast.error(`处理拖拽文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  export async function handleDropBrowserFiles(project: Project, files: File[]) {
    try {
      await StageFileImportService.importBrowserFiles(project, files);
    } catch (error) {
      toast.error(`处理拖拽文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 根据设置对文件列表排序
   */
  async function sortFileList(fileList: string[]): Promise<string[]> {
    const order = Settings.imageImportOrder;
    if (order === "path") {
      return [...fileList].sort();
    }
    // order === "mtime", sort by file modification time ascending
    const entries = await Promise.all(
      fileList.map(async (p) => ({ path: p, mtime: (await stat(p)).mtime?.getTime() ?? 0 })),
    );
    entries.sort((a, b) => a.mtime - b.mtime);
    return entries.map((e) => e.path);
  }

  /**
   * 把文件的绝对路径拖拽到舞台，生成一个文本节点
   * @param project
   * @param filePath 绝对路径
   */
  export async function handleDropFileAbsolutePath(project: Project, pathList: string[]) {
    for (const filePath of pathList) {
      let processedItem = filePath.trim();
      if (
        (processedItem.startsWith('"') && processedItem.endsWith('"')) ||
        (processedItem.startsWith("'") && processedItem.endsWith("'"))
      ) {
        if (processedItem.length >= 2) {
          processedItem = processedItem.slice(1, -1).trim();
        }
      }

      const { emoji, name } = PathString.getEmojiAndNameByPath(processedItem);

      const textNode = new TextNode(project, {
        text: `${emoji}${name}`,
        details: DetailsManager.markdownToDetails(processedItem),
        collisionBox: new CollisionBox([new Rectangle(project.camera.location.clone(), Vector.getZero())]),
      });

      project.stageManager.add(textNode);
    }
  }

  /**
   * 把文件的相对路径拖拽到舞台，生成一个文本节点
   * @param project
   * @param filePath 相对路径
   */
  export async function handleDropFileRelativePath(project: Project, pathList: string[]) {
    if (project.isDraft) {
      toast.error("草稿是未保存文件，没有路径，不能用相对路径导入");
      return;
    }
    // windows 的fsPath大概率是  d:/ 小写的盘符
    const currentProjectPath = PathString.uppercaseAbsolutePathDiskChar(project.uri.fsPath);

    for (const filePath of pathList) {
      const relativePath = PathString.getRelativePath(currentProjectPath, filePath);

      let processedItem = filePath.trim();
      if (
        (processedItem.startsWith('"') && processedItem.endsWith('"')) ||
        (processedItem.startsWith("'") && processedItem.endsWith("'"))
      ) {
        if (processedItem.length >= 2) {
          processedItem = processedItem.slice(1, -1).trim();
        }
      }

      const { emoji, name } = PathString.getEmojiAndNameByPath(processedItem);

      // 如果生成的相对路径为空或没有意义，降级处理
      const displayText = relativePath ? `${emoji}${relativePath}` : `${emoji}${name}`;

      const textNode = new TextNode(project, {
        text: displayText,
        details: DetailsManager.markdownToDetails(processedItem),
        collisionBox: new CollisionBox([new Rectangle(project.camera.location.clone(), Vector.getZero())]),
      });

      project.stageManager.add(textNode);
    }
  }

  /**
   * 处理图片文件拖拽到舞台（支持 png/jpg/jpeg/webp，统一转换为 PNG 存储）
   * 按 imageIndex 从左下阶梯排列：第1张在视野中心，之后每张相对前一张左移50px、下移50px
   */
  export async function handleDropImage(
    project: Project,
    filePath: string,
    sourceMime: string,
    imageIndex: number = 0,
  ): Promise<void> {
    const fileData = await readFile(filePath);
    await StageFileImportService.addImageBlob(
      project,
      new Blob([new Uint8Array(fileData)], { type: sourceMime }),
      sourceMime,
      imageIndex,
    );
  }

  /** @deprecated 请使用 handleDropImage */
  export async function handleDropPng(project: Project, filePath: string) {
    return handleDropImage(project, filePath, "image/png");
  }

  export async function handleDropTxt(project: Project, filePath: string) {
    const fileData = await readFile(filePath);
    const content = new TextDecoder().decode(fileData);
    await StageFileImportService.addTextContent(project, content);
  }

  export async function handleDropSvg(project: Project, filePath: string) {
    const fileData = await readFile(filePath);
    const content = new TextDecoder().decode(fileData);
    await StageFileImportService.addSvgText(project, content);
  }
}
