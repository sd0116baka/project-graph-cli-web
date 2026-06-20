import type { Project } from "@/core/Project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import { ReferenceFileScanner } from "./ReferenceFileScanner";
import { ServerProjectManager } from "./ServerProjectManager";

const tauriFsMock = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
}));

vi.mock("@/utils/pathString", () => ({
  PathString: {
    dirPath(path: string) {
      return path.replace(/[\\/][^\\/]*$/, "");
    },
    getFileNameFromPath(path: string) {
      return path
        .replace(/\\/g, "/")
        .split("/")
        .pop()!
        .replace(/\.prg$/i, "");
    },
    getSep() {
      return "\\";
    },
  },
}));

vi.mock("@tauri-apps/plugin-fs", () => tauriFsMock);

vi.mock("@tauri-apps/api/path", () => ({
  join(...parts: string[]) {
    return parts.join("\\");
  },
}));

function fakeServerProject(id: string): Project {
  return {
    uri: ServerProjectManager.projectUri(id),
    isDraft: false,
  } as Project;
}

describe("ReferenceFileScanner", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("resolves server project references through the backend index", async () => {
    vi.spyOn(ServerProjectManager, "resolveProjectReference").mockResolvedValue({
      name: "Design Notes",
      projectId: "target-project",
    });
    const listProjects = vi.spyOn(ServerProjectManager, "listProjects");

    const uri = await ReferenceFileScanner.findReferenceUri(fakeServerProject("source-project"), "Design Notes");

    expect(uri?.toString()).toBe(ServerProjectManager.projectUri("target-project").toString());
    expect(ServerProjectManager.resolveProjectReference).toHaveBeenCalledWith("source-project", "Design Notes");
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("can ensure server project references without creating local file URIs", async () => {
    vi.spyOn(ServerProjectManager, "ensureProjectReference").mockResolvedValue({
      name: "Design Notes",
      projectId: "target-project",
      created: true,
    });

    const reference = await ReferenceFileScanner.ensureReferenceUri(
      fakeServerProject("source-project"),
      "Design Notes",
    );

    expect(reference.name).toBe("Design Notes");
    expect(reference.created).toBe(true);
    expect(reference.uri.toString()).toBe(ServerProjectManager.projectUri("target-project").toString());
    expect(reference.uri.scheme).toBe("server");
  });

  it("does not resolve arbitrary same-name server projects outside the source reference index", async () => {
    vi.spyOn(ServerProjectManager, "resolveProjectReference").mockResolvedValue(undefined);
    const listProjects = vi.spyOn(ServerProjectManager, "listProjects");

    const uri = await ReferenceFileScanner.findReferenceUri(fakeServerProject("source-project"), "Legacy Source");

    expect(uri).toBeUndefined();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("keeps local projects on file reference folders", async () => {
    tauriFsMock.exists.mockResolvedValue(true);
    tauriFsMock.readDir.mockResolvedValue([{ name: "Foo.prg", isFile: true, isDirectory: false }]);
    const project = {
      uri: URI.file("C:/p/main.prg"),
      isDraft: false,
    } as Project;

    const uri = await ReferenceFileScanner.findReferenceUri(project, "Foo");

    expect(tauriFsMock.exists).toHaveBeenCalled();
    expect(tauriFsMock.readDir).toHaveBeenCalled();
    expect(uri?.scheme).toBe("file");
  });
});
