import { loadAllServicesAfterInit, loadAllServicesBeforeInit } from "@/core/loadAllServices";
import { Project, ProjectState } from "@/core/Project";
import { TabFactory } from "@/core/TabFactory";
import { activeTabAtom, store, tabsAtom } from "@/state";
import {
  applyOperationsToArchive,
  archiveToPgJson,
  exportMarkdown,
  exportMermaid,
  exportPgJson,
  queryArchive,
  type ProjectGraphPatch,
  type ProjectGraphQuery,
} from "@graphif/project-graph-core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { deserialize, serialize } from "@graphif/serializer";
import mime from "mime";
import { URI } from "vscode-uri";

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
const openingDocuments = new Map<string, Promise<Project>>();

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

  if (method === "open_document") {
    return openDocument(asRecord(params));
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

  if (method === "query") {
    return queryArchive(archive, normalizeQuery(options));
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

async function openDocument(params: Record<string, unknown>) {
  const rawUri = typeof params.uri === "string" ? params.uri : undefined;
  if (!rawUri) {
    throw new Error("Live open_document params must include a uri string.");
  }

  const uri = URI.parse(rawUri);
  if (uri.scheme !== "file") {
    throw new Error(`Live open_document currently supports file URIs only: ${uri.toString()}`);
  }
  if (!uri.path.toLowerCase().endsWith(".prg")) {
    throw new Error(`Live open_document only supports .prg files: ${uri.toString()}`);
  }

  const documentId = uri.toString();
  const existing = findProjectByDocumentId(documentId);
  if (existing) {
    activateProject(existing);
    return {
      opened: false,
      alreadyOpen: true,
      document: await describeProject(existing),
    };
  }

  const inFlight = openingDocuments.get(documentId);
  if (inFlight) {
    const opened = await inFlight;
    activateProject(opened);
    return {
      opened: false,
      alreadyOpen: true,
      document: await describeProject(opened),
    };
  }

  const opening = openAndRegisterProject(uri, documentId);
  openingDocuments.set(documentId, opening);
  const project = await opening.finally(() => {
    openingDocuments.delete(documentId);
  });
  activateProject(project);

  return {
    opened: true,
    alreadyOpen: false,
    document: await describeProject(project),
  };
}

async function openAndRegisterProject(uri: URI, documentId: string): Promise<Project> {
  const project = await loadProjectFromUri(uri);
  const existing = findProjectByDocumentId(documentId);
  if (existing) {
    await project.dispose();
    return existing;
  }
  store.set(tabsAtom, [...store.get(tabsAtom), project]);
  return project;
}

async function loadProjectFromUri(uri: URI): Promise<Project> {
  const dummyProject = new Project(uri);
  loadAllServicesBeforeInit(dummyProject);
  let tab: Awaited<ReturnType<typeof TabFactory.create>> | undefined;

  try {
    tab = await TabFactory.create(uri, dummyProject.fs);
    if (!(tab instanceof Project)) {
      throw new Error(`Live open_document only supports Project Graph documents: ${uri.toString()}`);
    }

    loadAllServicesBeforeInit(tab);
    await tab.init({ interactive: false });
    if (tab.projectState !== ProjectState.Saved) {
      throw new Error(`Live open_document failed to open document: ${uri.toString()}`);
    }
    loadAllServicesAfterInit(tab);
    return tab;
  } catch (error) {
    await tab?.dispose();
    throw error;
  } finally {
    await dummyProject.dispose();
  }
}

function activateProject(project: Project): void {
  store.set(activeTabAtom, project);
  project.loop();
  store
    .get(tabsAtom)
    .filter((tab): tab is Project => tab instanceof Project && tab !== project)
    .forEach((tab) => tab.pause());
}

function findProjectByDocumentId(documentId: string): Project | undefined {
  return store.get(tabsAtom).find((tab): tab is Project => tab instanceof Project && getDocumentId(tab) === documentId);
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
  const normalizedDocument = document ? normalizeDocumentTarget(document) : undefined;
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
        getDocumentId(tab) === document ||
        getDocumentId(tab) === normalizedDocument ||
        tab.uri.toString() === document ||
        tab.uri.toString() === normalizedDocument ||
        String(index) === document,
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

function normalizeDocumentTarget(document: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(document)) {
    return URI.file(document).toString();
  }
  try {
    const uri = URI.parse(document);
    if (uri.scheme === "file") {
      return uri.toString();
    }
  } catch {
    // Keep the original document target for non-URI ids such as tab indexes.
  }
  return document;
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
    const patch: Record<string, unknown> = { ops: record.ops };
    if (record.baseRevision !== undefined) {
      patch.baseRevision = record.baseRevision;
    }
    return patch as unknown as ProjectGraphPatch;
  }
  throw new Error("Live patch params must be an operation array or an object with an ops array.");
}

function normalizeQuery(params: Record<string, unknown>): ProjectGraphQuery {
  const query: ProjectGraphQuery = {};
  if (
    params.kind === "all" ||
    params.kind === "node" ||
    params.kind === "section" ||
    params.kind === "edge" ||
    params.kind === "attachment" ||
    params.kind === "unsupported"
  ) {
    query.kind = params.kind;
  }
  if (typeof params.id === "string") {
    query.id = params.id;
  }
  if (typeof params.text === "string") {
    query.text = params.text;
  }
  if (typeof params.section === "string" || params.section === null) {
    query.section = params.section;
  }
  if (typeof params.limit === "number" && Number.isInteger(params.limit) && params.limit > 0) {
    query.limit = params.limit;
  }
  if (params.includeUnsupported === true) {
    query.includeUnsupported = true;
  }
  return query;
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
