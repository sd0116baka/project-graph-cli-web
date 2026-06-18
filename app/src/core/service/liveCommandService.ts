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
import mime from "mime";

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

interface LiveDocument {
  id: string;
  index: number;
  title: string;
  active: boolean;
  type: "project" | "tab";
  uri: string | null;
  state: string | null;
  dirty: boolean | null;
  revision: number | null;
}

interface RevisionEntry {
  fingerprint: string;
  revision: number;
}

let liveStarted = false;
const documentRevisions = new Map<string, RevisionEntry>();

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

  const options = asRecord(params);
  const project = resolveProject(options);
  const archive = await projectToArchive(project);
  const revision = await getProjectRevision(project);

  if (method === "inspect") {
    return {
      document: await describeProject(project),
      revision,
      pgjson: archiveToPgJson(archive),
    };
  }

  if (method === "export") {
    const format = typeof options.format === "string" ? options.format : "pgjson";
    let content: string;
    if (format === "pgjson") {
      content = exportPgJson(archive);
    } else if (format === "markdown") {
      content = exportMarkdown(archive, typeof options.root === "string" ? options.root : undefined);
    } else if (format === "mermaid") {
      content = exportMermaid(archive);
    } else {
      throw new Error(`Unsupported live export format: ${format}`);
    }
    return {
      document: await describeProject(project),
      revision,
      format,
      content,
    };
  }

  if (method === "patch") {
    const { patch, save } = normalizePatchRequest(params);
    if (patch.baseRevision !== undefined && patch.baseRevision !== revision) {
      throw new Error(`Live patch revision mismatch: expected ${patch.baseRevision}, current ${revision}.`);
    }
    const result = applyOperationsToArchive(archive, patch);
    applyArchiveToProject(project, result.archive);
    const nextRevision = await setProjectRevision(project, revision + 1);
    const warnings = [...result.warnings];
    const saveResult = await saveProjectIfRequested(project, save, warnings);
    return {
      changed: result.changed,
      warnings,
      saved: saveResult.saved,
      uri: saveResult.uri,
      state: ProjectState[project.projectState],
      document: await describeProject(project),
      previousRevision: revision,
      revision: nextRevision,
    };
  }

  throw new Error(`Unsupported live method: ${method}`);
}

async function listDocuments() {
  const active = store.get(activeTabAtom);
  return Promise.all(
    store.get(tabsAtom).map(async (tab, index) => ({
      ...(tab instanceof Project
        ? await describeProject(tab, index, tab === active)
        : {
            id: `tab:${index}`,
            index,
            title: tab.title,
            active: tab === active,
            type: "tab" as const,
            uri: null,
            state: null,
            dirty: null,
            revision: null,
          }),
    })),
  );
}

async function projectToArchive(project: Project): Promise<CoreArchive> {
  return {
    stage: serialize(project.stage),
    tags: [...project.tags],
    references: structuredClone(project.references),
    metadata: structuredClone(project.metadata),
    readme: project.readme,
    attachments: new Map(
      await Promise.all(
        [...project.attachments.entries()].map(async ([id, blob]) => {
          const extension = extensionFromMime(blob.type);
          return [
            id,
            {
              id,
              extension,
              path: `attachments/${id}.${extension}`,
              data: new Uint8Array(await blob.arrayBuffer()),
            },
          ] as const;
        }),
      ),
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

async function describeProject(
  project: Project,
  index = getProjectIndex(project),
  active = store.get(activeTabAtom) === project,
): Promise<LiveDocument> {
  return {
    id: getDocumentId(project),
    index,
    title: project.title,
    active,
    type: "project",
    uri: project.uri.toString(),
    state: ProjectState[project.projectState],
    dirty: project.projectState !== ProjectState.Saved,
    revision: await getProjectRevision(project),
  };
}

function resolveProject(params: Record<string, unknown>): Project {
  const document = typeof params.document === "string" ? params.document : undefined;
  const projects = store
    .get(tabsAtom)
    .map((tab, index) => ({ tab, index }))
    .filter((entry): entry is { tab: Project; index: number } => entry.tab instanceof Project);

  if (projects.length === 0) {
    throw new Error("No Project Graph document is open.");
  }

  if (document) {
    const matches = projects.filter(
      ({ tab, index }) =>
        getDocumentId(tab) === document || tab.uri.toString() === document || String(index) === document,
    );
    if (matches.length === 1) {
      return matches[0].tab;
    }
    if (matches.length > 1) {
      throw new Error(`Live document target is ambiguous: ${document}.`);
    }
    throw new Error(`Live document not found: ${document}.`);
  }

  if (projects.length === 1) {
    return projects[0].tab;
  }

  throw new Error(
    `Multiple Project Graph documents are open. Pass --document <id>. Available ids: ${projects
      .map(({ tab }) => getDocumentId(tab))
      .join(", ")}`,
  );
}

function getDocumentId(project: Project): string {
  return project.uri.toString();
}

function getProjectIndex(project: Project): number {
  return store.get(tabsAtom).indexOf(project);
}

async function getProjectRevision(project: Project): Promise<number> {
  const id = getDocumentId(project);
  const fingerprint = await getProjectFingerprint(project);
  const existing = documentRevisions.get(id);
  if (!existing) {
    documentRevisions.set(id, { fingerprint, revision: 0 });
    return 0;
  }
  if (existing.fingerprint !== fingerprint) {
    existing.fingerprint = fingerprint;
    existing.revision++;
  }
  return existing.revision;
}

async function setProjectRevision(project: Project, revision: number): Promise<number> {
  documentRevisions.set(getDocumentId(project), {
    fingerprint: await getProjectFingerprint(project),
    revision,
  });
  return revision;
}

async function getProjectFingerprint(project: Project): Promise<string> {
  return JSON.stringify({
    stageHash: project.stageHash,
    tags: project.tags,
    references: project.references,
    metadata: project.metadata,
    readme: project.readme,
    attachments: await Promise.all(
      [...project.attachments.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([id, blob]) => ({ id, type: blob.type, size: blob.size, sha256: await hashBlob(blob) })),
    ),
  });
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function extensionFromMime(mimeType: string): string {
  return mime.getExtension(mimeType) ?? "bin";
}
