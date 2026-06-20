import { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { RectanglePushInEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectanglePushInEffect";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { SvgNode } from "@/core/stage/stageObject/entity/SvgNode";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { toast } from "sonner";
import { applyBlackAndWhite } from "./imageUtils";

export namespace StageFileImportService {
  const maxBrowserImportFileSize = 50 * 1024 * 1024;
  const imageTypeSet = new Set(["png", "jpg", "jpeg", "webp"]);
  const textTypeSet = new Set([
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
  ]);

  export async function importBrowserFiles(project: Project, files: File[]): Promise<number> {
    for (const file of files) {
      assertBrowserFileSize(file);
    }

    const sortedImageFiles = sortBrowserImageFiles(files.filter((file) => imageTypeSet.has(extensionOf(file.name))));
    let imageIndex = 0;
    let importedCount = 0;

    try {
      for (const file of files) {
        const extName = extensionOf(file.name);
        if (imageTypeSet.has(extName)) {
          const imageFile = sortedImageFiles[imageIndex] ?? file;
          await addImageBlob(project, imageFile, imageMimeFromFile(imageFile), imageIndex);
          imageIndex++;
          importedCount++;
        } else if (extName === "svg" || file.type === "image/svg+xml") {
          await addSvgText(project, await file.text());
          importedCount++;
        } else if (textTypeSet.has(extName) || file.type.startsWith("text/")) {
          await addTextContent(project, await file.text());
          importedCount++;
        } else if (extName === "prg") {
          toast.warning("浏览器端暂不支持通过拖拽打开本地 .prg 文件");
        } else {
          toast.error(`不支持的文件类型: 【${extName || file.type || "未知"}】`);
        }
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

  export async function addImageBlob(
    project: Project,
    sourceBlob: Blob,
    sourceMime: string,
    imageIndex: number = 0,
  ): Promise<void> {
    const blob =
      sourceMime === "image/png" &&
      !Settings.resizePastedImages &&
      !Settings.compressImageToWebp &&
      !Settings.compressImageToBlackAndWhite
        ? new Blob([await sourceBlob.arrayBuffer()], { type: "image/png" })
        : await convertToPngBlob(sourceBlob);

    const attachmentId = project.addAttachment(blob);
    const addLocation = project.camera.location.clone();
    addLocation.x += -imageIndex * 50;
    addLocation.y += imageIndex * 50;

    const imageNode = new ImageNode(
      project,
      {
        attachmentId,
        collisionBox: new CollisionBox([new Rectangle(addLocation, new Vector(1, 1))]),
      },
      false,
      Settings.wrapImageInGroup
        ? () => {
            const section = Section.fromEntities(project, [imageNode]);
            section.text = "";
            project.stageManager.add(section);
          }
        : undefined,
    );

    project.stageManager.add(imageNode);

    const mouseSections = project.sectionMethods.getSectionsByInnerLocation(addLocation);
    if (mouseSections.length > 0) {
      project.stageManager.goInSection([imageNode], mouseSections[0]);
      project.effects.addEffect(
        RectanglePushInEffect.sectionGoInGoOut(
          imageNode.collisionBox.getRectangle(),
          mouseSections[0].collisionBox.getRectangle(),
        ),
      );
    }
  }

  export async function addTextContent(project: Project, content: string): Promise<void> {
    const textNode = new TextNode(project, {
      text: content,
      collisionBox: new CollisionBox([new Rectangle(project.camera.location.clone(), new Vector(300, 150))]),
      sizeAdjust: "manual",
    });

    project.stageManager.add(textNode);
  }

  export async function addSvgText(project: Project, content: string): Promise<void> {
    const svg = new DOMParser().parseFromString(content, "image/svg+xml");
    const item = new XMLSerializer().serializeToString(svg.documentElement);
    const attachmentId = project.addAttachment(new Blob([item], { type: "image/svg+xml" }));
    const entity = new SvgNode(project, {
      attachmentId,
    });
    project.stageManager.add(entity);
  }

  export function textFileExtensions(): string[] {
    return [...textTypeSet];
  }

  export function assertBrowserFileSize(file: File): void {
    if (file.size > maxBrowserImportFileSize) {
      throw new Error(`文件 "${file.name}" 超过 ${formatBytes(maxBrowserImportFileSize)}，请拆分后再导入`);
    }
  }

  export function imageMimeFromFile(file: File): string {
    if (file.type) return file.type;
    const ext = extensionOf(file.name);
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    return "image/png";
  }

  async function convertToPngBlob(sourceBlob: Blob): Promise<Blob> {
    const url = URL.createObjectURL(sourceBlob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        if (Settings.resizePastedImages) {
          const maxSize = Settings.maxPastedImageSize;
          const maxDim = Math.max(w, h);
          if (maxDim > maxSize) {
            const scale = maxSize / maxDim;
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("无法获取 Canvas 2D 上下文"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        if (Settings.compressImageToBlackAndWhite) {
          applyBlackAndWhite(canvas);
        }

        const outputType = Settings.compressImageToBlackAndWhite
          ? "image/png"
          : Settings.compressImageToWebp
            ? "image/webp"
            : "image/png";
        canvas.toBlob(
          (blob) => {
            if (blob) {
              if (outputType === "image/webp" && !blob.type.includes("webp")) {
                toast.warning("当前系统 webview 不支持 WebP 编码，已回退为 PNG");
              }
              resolve(blob);
            } else {
              reject(new Error("Canvas toBlob 失败"));
            }
          },
          outputType,
          Settings.compressImageToBlackAndWhite
            ? undefined
            : Settings.compressImageToWebp
              ? Settings.webpQuality
              : undefined,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      img.src = url;
    });
  }

  function sortBrowserImageFiles(fileList: File[]): File[] {
    if (Settings.imageImportOrder === "path") {
      return [...fileList].sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...fileList].sort((a, b) => a.lastModified - b.lastModified);
  }

  function extensionOf(path: string): string {
    return path.split(".").pop()?.toLowerCase() ?? "";
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
