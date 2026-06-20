export type BrowserFilePickerOptions = {
  accept?: string;
  multiple?: boolean;
};

export async function pickBrowserFiles({ accept = "", multiple = false }: BrowserFilePickerOptions = {}): Promise<
  File[]
> {
  if (typeof document === "undefined") {
    throw new Error("当前运行时不支持浏览器文件选择器");
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";

    let settled = false;
    const settle = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          settle([]);
        }
      }, 300);
    };

    input.addEventListener("change", () => {
      settle(Array.from(input.files ?? []));
    });
    input.addEventListener("cancel", () => {
      settle([]);
    });

    document.body.append(input);
    window.setTimeout(() => window.addEventListener("focus", onFocus, { once: true }), 0);
    input.click();
  });
}

export async function pickBrowserDirectory(): Promise<File[]> {
  if (typeof document === "undefined") {
    throw new Error("当前运行时不支持浏览器目录选择器");
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    input.style.display = "none";

    let settled = false;
    const settle = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) {
          settle([]);
        }
      }, 300);
    };

    input.addEventListener("change", () => {
      settle(Array.from(input.files ?? []));
    });
    input.addEventListener("cancel", () => {
      settle([]);
    });

    document.body.append(input);
    window.setTimeout(() => window.addEventListener("focus", onFocus, { once: true }), 0);
    input.click();
  });
}

export function extensionAccept(extensions: string[]): string {
  return extensions.map((extension) => `.${extension}`).join(",");
}

export function downloadBrowserBlob(blob: Blob, suggestedName: string): void {
  if (typeof document === "undefined") {
    throw new Error("当前运行时不支持浏览器下载");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
