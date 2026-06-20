import { cn } from "./utils/cn";
import { useEffect, useRef, useState } from "react";
import { isMac } from "./utils/platform";
import { isTauriRuntime } from "./utils/runtime";
import type { Project } from "./core/Project";
import { toast } from "sonner";
import { StageFileImportService } from "./core/service/dataManageService/StageFileImportService";

/**
 * 拖拽鼠标进入舞台时，覆盖一个提示区域
 * 用于提示用户在不同位置释放有不同的效果
 */
export const DropWindowCover = ({ project }: { project: Project }) => {
  const fadeOutMs = 700;
  const [dropMouseLocation, setDropMouseLocation] = useState<"top" | "middle" | "bottom" | "notInWindowZone">(
    "notInWindowZone",
  );
  const [isFadingOut, setIsFadingOut] = useState(false);
  const isDraft = project.isDraft;
  const isTauri = isTauriRuntime();

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cancelAnimation = () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      hideTimerRef.current = null;
      rafRef.current = null;
    };

    const showDropLocation = (dropLocation: "top" | "middle" | "bottom") => {
      cancelAnimation();
      setIsFadingOut(false);
      setDropMouseLocation(dropLocation);
    };
    const fadeOutDropLocation = (dropLocation: "top" | "middle" | "bottom") => {
      cancelAnimation();
      setIsFadingOut(false);
      setDropMouseLocation(dropLocation);
      rafRef.current = requestAnimationFrame(() => {
        setIsFadingOut(true);
      });
      hideTimerRef.current = setTimeout(() => {
        setDropMouseLocation("notInWindowZone");
        setIsFadingOut(false);
      }, fadeOutMs);
    };
    const dropLocationFromY = (y: number, height: number) =>
      y <= height / 3 ? "top" : y <= (height / 3) * 2 ? "middle" : "bottom";

    if (!isTauri) {
      const onDragOver = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        showDropLocation(dropLocationFromY(event.clientY, window.innerHeight));
      };
      const onDragLeave = () => {
        cancelAnimation();
        setIsFadingOut(false);
        setDropMouseLocation("notInWindowZone");
      };
      const onDrop = (event: DragEvent) => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        const dropLocation = dropLocationFromY(event.clientY, window.innerHeight);
        fadeOutDropLocation(dropLocation);

        if (dropLocation === "top") {
          void StageFileImportService.importBrowserFiles(project, Array.from(event.dataTransfer.files)).catch(
            (error) => {
              toast.error(`处理拖拽文件失败: ${error instanceof Error ? error.message : String(error)}`);
            },
          );
        } else {
          toast.warning("浏览器端无法读取本机文件路径，请拖拽到顶部区域导入文件内容");
        }
      };

      window.addEventListener("dragover", onDragOver);
      window.addEventListener("dragleave", onDragLeave);
      window.addEventListener("drop", onDrop);
      return () => {
        cancelAnimation();
        window.removeEventListener("dragover", onDragOver);
        window.removeEventListener("dragleave", onDragLeave);
        window.removeEventListener("drop", onDrop);
      };
    }

    const unlistenPromise = Promise.all([
      import("@tauri-apps/api/window"),
      import("@/core/service/dataManageService/dragFileIntoStageEngine/dragFileIntoStageEngine"),
    ]).then(async ([{ getCurrentWindow }, { DragFileIntoStageEngine }]) => {
      const currentWindow = getCurrentWindow();
      return currentWindow.onDragDropEvent(async (event) => {
        const size = await currentWindow.outerSize();
        const logicalHeight = isMac ? size.height / (await currentWindow.scaleFactor()) : size.height;
        const getDropLocation = (y: number) => dropLocationFromY(y, logicalHeight);

        if (event.payload.type === "over") {
          showDropLocation(getDropLocation(event.payload.position.y));
        } else if (event.payload.type === "leave") {
          cancelAnimation();
          setIsFadingOut(false);
          setDropMouseLocation("notInWindowZone");
        } else if (event.payload.type === "drop") {
          const dropLocation = getDropLocation(event.payload.position.y);
          fadeOutDropLocation(dropLocation);

          if (dropLocation === "top") {
            DragFileIntoStageEngine.handleDrop(project, event.payload.paths);
          } else if (dropLocation === "middle") {
            DragFileIntoStageEngine.handleDropFileRelativePath(project, event.payload.paths);
          } else {
            DragFileIntoStageEngine.handleDropFileAbsolutePath(project, event.payload.paths);
          }
        }
      });
    });

    return () => {
      cancelAnimation();
      void unlistenPromise.then((f) => f());
    };
  }, [isTauri, project]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-5 flex h-screen w-full flex-col transition-opacity duration-700 ease-out",
        dropMouseLocation === "notInWindowZone" ? "opacity-0" : isFadingOut ? "opacity-0" : "opacity-100",
      )}
    >
      <div
        className={cn(
          "bg-card/80 flex flex-1 flex-col items-center justify-center text-xl",
          dropMouseLocation === "top" && "text-destructive bg-transparent",
        )}
      >
        <p>拖拽到这里：追加到舞台</p>
        <span className="text-sm">
          {isTauri
            ? "如果是图片文件（png/jpg/jpeg/webp），则追加到舞台，如果是prg工程文件，则打开标签页"
            : "支持图片、SVG 和文本文件，导入后会写入当前项目"}
        </span>
      </div>
      <div
        className={cn(
          "bg-card/80 flex flex-1 flex-col items-center justify-center text-xl",
          dropMouseLocation === "middle" && !isDraft && isTauri && "text-destructive bg-transparent",
          (isDraft || !isTauri) && "cursor-not-allowed opacity-40",
        )}
      >
        <p>
          拖拽到这里：以 <span className="text-3xl">相对路径</span> 生成文本节点到舞台
        </p>
        {isDraft && <span className="text-sm">（草稿文件无路径，无法使用相对路径）</span>}
        {!isTauri && <span className="text-sm">（浏览器无法读取本机相对路径）</span>}
      </div>
      <div
        className={cn(
          "bg-card/80 flex flex-1 flex-col items-center justify-center text-xl",
          dropMouseLocation === "bottom" && isTauri && "text-destructive bg-transparent",
          !isTauri && "cursor-not-allowed opacity-40",
        )}
      >
        <p>
          拖拽到这里：以 <span className="text-3xl">绝对路径</span> 生成文本节点到舞台
        </p>

        <span className="text-sm">
          {isTauri
            ? "这样就可以构建外部文件链接，选中路径为内容的文本节点，直接调用系统默认方式打开此文件了"
            : "浏览器无法读取本机绝对路径"}
        </span>
      </div>
    </div>
  );
};
