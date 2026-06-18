import { Project, ProjectState } from "@/core/Project";
import { activeTabAtom, store, tabsAtom } from "@/state";
import {
  applyOperationsToArchive,
  archiveToPgJson,
  exportMarkdown,
  exportMermaid,
  exportPgJson,
  type ProjectGraphPatch,
} from "@graphif/project-graph-core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { deserialize, serialize } from "@graphif/serializer";

interface LiveSession {
  id: string;
  port: number;
  token: string;
  pid: number;
  registryPath: string;
}

interface LiveRequest {
  id: string;
  method: string;
  params: unknown;
}

type CoreArchive = Parameters<typeof applyOperationsToArchive>[0];

let liveStarted = false;

export async function startLiveCommandService(port?: number): Promise<LiveSession> {
  if (liveStarted) {
    return invoke<LiveSession>("project_graph_live_start", { port });
  }
  liveStarted = true;

  const session = await invoke<LiveSession>("project_graph_live_start", { port });
  await listen<LiveRequest>("project-graph-live-request", async (event) => {
    const request = event.payload;
    try {
      const result = await handleLiveRequest(request.method, request.params);
      await invoke("project_graph_live_response", {
        id: request.id,
        response: { id: request.id, ok: true, result },
      });
    } catch (error) {
      await invoke("project_graph_live_response", {
        id: request.id,
        response: { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  console.info(
    `[Project Graph live] listening on 127.0.0.1:${session.port}; session registry: ${session.registryPath}`,
  );
  return session;
}

async function handleLiveRequest(method: string, params: unknown): Promise<unknown> {
  if (method === "list_documents") {
    return listDocuments();
  }

  const project = getActiveProject();
  const archive = projectToArchive(project);

  if (method === "inspect") {
    return archiveToPgJson(archive);
  }

  if (method === "export") {
    const options = asRecord(params);
    const format = typeof options.format === "string" ? options.format : "pgjson";
    if (format === "pgjson") {
      return exportPgJson(archive);
    }
    if (format === "markdown") {
      return exportMarkdown(archive, typeof options.root === "string" ? options.root : undefined);
    }
    if (format === "mermaid") {
      return exportMermaid(archive);
    }
    throw new Error(`Unsupported live export format: ${format}`);
  }

  if (method === "patch") {
    const { patch, save } = normalizePatchRequest(params);
    const result = applyOperationsToArchive(archive, patch);
    applyArchiveToProject(project, result.archive);
    const warnings = [...result.warnings];
    const saveResult = await saveProjectIfRequested(project, save, warnings);
    return {
      changed: result.changed,
      warnings,
      saved: saveResult.saved,
      uri: saveResult.uri,
      state: ProjectState[project.projectState],
    };
  }

  throw new Error(`Unsupported live method: ${method}`);
}

function listDocuments() {
  const active = store.get(activeTabAtom);
  return store.get(tabsAtom).map((tab, index) => ({
    index,
    title: tab.title,
    active: tab === active,
    type: tab instanceof Project ? "project" : "tab",
    uri: tab instanceof Project ? tab.uri.toString() : null,
    state: tab instanceof Project ? ProjectState[tab.projectState] : null,
  }));
}

function projectToArchive(project: Project): CoreArchive {
  return {
    stage: serialize(project.stage),
    tags: [...project.tags],
    references: structuredClone(project.references),
    metadata: structuredClone(project.metadata),
    readme: project.readme,
    attachments: new Map(
      [...project.attachments.entries()].map(([id, blob]) => [
        id,
        {
          id,
          extension: extensionFromMime(blob.type),
          path: `attachments/${id}.${extensionFromMime(blob.type)}`,
          data: new Uint8Array(),
        },
      ]),
    ),
    extraEntries: new Map(),
  };
}

function applyArchiveToProject(project: Project, archive: CoreArchive): void {
  project.stage = deserialize(archive.stage, project);
  project.tags = archive.tags;
  project.references = archive.references;
  project.metadata = archive.metadata;
  project.readme = archive.readme;
  project.stageManager.updateReferences();
  project.historyManager.recordStep();
  project.projectState = ProjectState.Unsaved;
  project.loop();
}

async function saveProjectIfRequested(
  project: Project,
  save: boolean,
  warnings: string[],
): Promise<{ saved: boolean; uri: string | null }> {
  if (!save) {
    return { saved: false, uri: null };
  }
  if (project.isDraft) {
    warnings.push("Live patch changed a draft document; skipping automatic save to avoid opening a save dialog.");
    return { saved: false, uri: null };
  }

  await project.save({ includeThumbnail: false });
  return { saved: true, uri: project.uri.toString() };
}

function getActiveProject(): Project {
  const active = store.get(activeTabAtom);
  if (!(active instanceof Project)) {
    throw new Error("No active Project Graph document.");
  }
  return active;
}

function normalizePatchRequest(params: unknown): { patch: ProjectGraphPatch; save: boolean } {
  const record = asRecord(params);
  return {
    patch: normalizePatch(params),
    save: record.save !== false,
  };
}

function normalizePatch(params: unknown): ProjectGraphPatch {
  if (Array.isArray(params)) {
    return { ops: params as ProjectGraphPatch["ops"] };
  }
  const record = asRecord(params);
  if (Array.isArray(record.ops)) {
    return record as unknown as ProjectGraphPatch;
  }
  throw new Error("Live patch params must be an operation array or an object with an ops array.");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function extensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  return "bin";
}
