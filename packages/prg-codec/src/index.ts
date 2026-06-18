import { decode, encode } from "@msgpack/msgpack";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { readFile, writeFile } from "node:fs/promises";

export interface PrgMetadata {
  version: string;
  extension?: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
  };
}

export interface PrgReferences {
  sections: Record<string, string[]>;
  files: string[];
}

export interface PrgAttachment {
  id: string;
  extension: string;
  path: string;
  data: Uint8Array;
}

export interface PrgArchive {
  stage: unknown[];
  tags: string[];
  references: PrgReferences;
  metadata: PrgMetadata;
  readme?: string;
  attachments: Map<string, PrgAttachment>;
  thumbnail?: Uint8Array;
  extraEntries: Map<string, Uint8Array>;
}

export interface WritePrgOptions {
  preserveThumbnail?: boolean;
  preserveExtraEntries?: boolean;
  compressionLevel?: number;
}

export type ValidationSeverity = "error" | "warning";

export interface PrgValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface PrgValidationReport {
  ok: boolean;
  issues: PrgValidationIssue[];
}

export interface PrgInspection {
  version: string;
  stageObjectCount: number;
  tagsCount: number;
  attachmentCount: number;
  hasReadme: boolean;
  hasThumbnail: boolean;
  extraEntryCount: number;
  objectTypes: Record<string, number>;
  textNodeCount: number;
  sectionCount: number;
  edgeCount: number;
}

type RecordValue = Record<string, unknown>;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export async function readPrgFile(path: string): Promise<PrgArchive> {
  const data = await readFile(path);
  return readPrgData(data);
}

export async function writePrgFile(path: string, archive: PrgArchive, options: WritePrgOptions = {}): Promise<void> {
  const data = await writePrgData(archive, options);
  await writeFile(path, data);
}

export async function readPrgData(data: Uint8Array): Promise<PrgArchive> {
  const reader = new ZipReader(new Uint8ArrayReader(data));
  const entries = await reader.getEntries();

  let stage: unknown[] = [];
  let tags: string[] = [];
  let references: PrgReferences = { sections: {}, files: [] };
  let metadata: PrgMetadata = { version: "2.0.0" };
  let readme: string | undefined;
  let thumbnail: Uint8Array | undefined;
  const attachments = new Map<string, PrgAttachment>();
  const extraEntries = new Map<string, Uint8Array>();

  try {
    for (const entry of entries) {
      if (entry.directory) {
        continue;
      }
      const entryData = await entry.getData?.(new Uint8ArrayWriter());
      if (!entryData) {
        continue;
      }

      if (entry.filename === "stage.msgpack") {
        const decoded = decode(entryData);
        stage = Array.isArray(decoded) ? decoded : [];
      } else if (entry.filename === "tags.msgpack") {
        const decoded = decode(entryData);
        tags = Array.isArray(decoded) ? decoded.filter((tag): tag is string => typeof tag === "string") : [];
      } else if (entry.filename === "reference.msgpack") {
        references = normalizeReferences(decode(entryData));
      } else if (entry.filename === "metadata.msgpack") {
        metadata = normalizeMetadata(decode(entryData));
      } else if (entry.filename === "README.md") {
        readme = textDecoder.decode(entryData);
      } else if (entry.filename === "thumbnail.png") {
        thumbnail = entryData;
      } else if (entry.filename.startsWith("attachments/")) {
        const attachment = parseAttachment(entry.filename, entryData);
        if (attachment) {
          attachments.set(attachment.id, attachment);
        } else {
          extraEntries.set(entry.filename, entryData);
        }
      } else {
        extraEntries.set(entry.filename, entryData);
      }
    }
  } finally {
    await reader.close();
  }

  return {
    stage,
    tags,
    references,
    metadata,
    readme,
    attachments,
    thumbnail,
    extraEntries,
  };
}

export async function writePrgData(archive: PrgArchive, options: WritePrgOptions = {}): Promise<Uint8Array> {
  const level = options.compressionLevel ?? 0;
  const attachments = archive.attachments ?? new Map<string, PrgAttachment>();
  const extraEntries = archive.extraEntries ?? new Map<string, Uint8Array>();
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { level });

  try {
    await writer.add("stage.msgpack", new Uint8ArrayReader(encode(archive.stage)), { level });
    await writer.add("tags.msgpack", new Uint8ArrayReader(encode(archive.tags)), { level });
    await writer.add("reference.msgpack", new Uint8ArrayReader(encode(archive.references)), { level });
    await writer.add("metadata.msgpack", new Uint8ArrayReader(encode(archive.metadata)), { level });

    if (archive.readme !== undefined) {
      await writer.add("README.md", new Uint8ArrayReader(textEncoder.encode(archive.readme)), { level });
    }

    for (const attachment of attachments.values()) {
      await writer.add(attachment.path, new Uint8ArrayReader(attachment.data), { level });
    }

    if (options.preserveThumbnail && archive.thumbnail) {
      await writer.add("thumbnail.png", new Uint8ArrayReader(archive.thumbnail), { level });
    }

    if (options.preserveExtraEntries) {
      for (const [path, data] of extraEntries.entries()) {
        await writer.add(path, new Uint8ArrayReader(data), { level });
      }
    }
  } finally {
    await writer.close();
  }

  return output.getData();
}

export function inspectPrgArchive(archive: PrgArchive): PrgInspection {
  const objectTypes: Record<string, number> = {};
  for (const item of archive.stage) {
    const type = getSerializedType(item);
    objectTypes[type] = (objectTypes[type] ?? 0) + 1;
  }

  return {
    version: archive.metadata.version,
    stageObjectCount: archive.stage.length,
    tagsCount: archive.tags.length,
    attachmentCount: archive.attachments.size,
    hasReadme: archive.readme !== undefined,
    hasThumbnail: archive.thumbnail !== undefined,
    extraEntryCount: archive.extraEntries.size,
    objectTypes,
    textNodeCount: objectTypes.TextNode ?? 0,
    sectionCount: objectTypes.Section ?? 0,
    edgeCount: (objectTypes.LineEdge ?? 0) + (objectTypes.ArcEdge ?? 0) + (objectTypes.CubicCatmullRomSplineEdge ?? 0),
  };
}

export function validatePrgArchive(archive: PrgArchive): PrgValidationReport {
  const issues: PrgValidationIssue[] = [];

  if (!archive.metadata.version) {
    issues.push({
      severity: "warning",
      code: "missing_metadata_version",
      message: "metadata.version is missing; Project Graph will treat the document as an older format.",
      path: "metadata.msgpack",
    });
  }

  if (!Array.isArray(archive.stage)) {
    issues.push({
      severity: "error",
      code: "invalid_stage",
      message: "stage.msgpack must decode to an array.",
      path: "stage.msgpack",
    });
  }

  const uuids = new Set<string>();
  const duplicateUuids = new Set<string>();

  archive.stage.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push({
        severity: "error",
        code: "invalid_stage_object",
        message: `Stage item at index ${index} is not an object.`,
        path: `/stage/${index}`,
      });
      return;
    }

    if (typeof item._ !== "string") {
      issues.push({
        severity: "warning",
        code: "missing_stage_object_type",
        message: `Stage item at index ${index} does not have a serialized type.`,
        path: `/stage/${index}/_`,
      });
    }

    if (typeof item.uuid === "string") {
      if (uuids.has(item.uuid)) {
        duplicateUuids.add(item.uuid);
      }
      uuids.add(item.uuid);
    } else {
      issues.push({
        severity: "warning",
        code: "missing_uuid",
        message: `Stage item at index ${index} does not have a uuid.`,
        path: `/stage/${index}/uuid`,
      });
    }
  });

  for (const uuid of duplicateUuids) {
    issues.push({
      severity: "error",
      code: "duplicate_uuid",
      message: `Duplicate stage object uuid: ${uuid}.`,
    });
  }

  archive.stage.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    validateAssociations(archive.stage, uuids, item, index, issues);
    validateSectionChildren(archive.stage, uuids, item, index, issues);
    validateAttachmentReference(archive.attachments, item, index, issues);
  });

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function normalizeMetadata(value: unknown): PrgMetadata {
  if (isRecord(value) && typeof value.version === "string") {
    return value as unknown as PrgMetadata;
  }
  return { version: "2.0.0" };
}

function normalizeReferences(value: unknown): PrgReferences {
  if (!isRecord(value)) {
    return { sections: {}, files: [] };
  }
  return {
    sections: isRecord(value.sections) ? (value.sections as Record<string, string[]>) : {},
    files: Array.isArray(value.files) ? value.files.filter((file): file is string => typeof file === "string") : [],
  };
}

function parseAttachment(path: string, data: Uint8Array): PrgAttachment | undefined {
  const match = path.match(/^attachments\/([a-zA-Z0-9-]+)\.([a-zA-Z0-9]+)$/);
  if (!match) {
    return undefined;
  }
  return {
    id: match[1]!,
    extension: match[2]!,
    path,
    data,
  };
}

function validateAssociations(
  rootStage: unknown[],
  uuids: Set<string>,
  item: RecordValue,
  index: number,
  issues: PrgValidationIssue[],
) {
  const type = getSerializedType(item);
  if (!isAssociationType(type)) {
    return;
  }

  if (!Array.isArray(item.associationList)) {
    issues.push({
      severity: "error",
      code: "missing_association_list",
      message: `${type} at index ${index} does not have an associationList array.`,
      path: `/stage/${index}/associationList`,
    });
    return;
  }

  if (item.associationList.length < 2) {
    issues.push({
      severity: "error",
      code: "short_association_list",
      message: `${type} at index ${index} must reference at least two entities.`,
      path: `/stage/${index}/associationList`,
    });
  }

  item.associationList.forEach((target, targetIndex) => {
    const resolved = resolveSerializedRef(rootStage, target);
    const uuid = isRecord(resolved) && typeof resolved.uuid === "string" ? resolved.uuid : undefined;
    if (!uuid || !uuids.has(uuid)) {
      issues.push({
        severity: "error",
        code: "missing_association_target",
        message: `${type} at index ${index} references a missing entity at associationList[${targetIndex}].`,
        path: `/stage/${index}/associationList/${targetIndex}`,
      });
    }
  });
}

function validateSectionChildren(
  rootStage: unknown[],
  uuids: Set<string>,
  item: RecordValue,
  index: number,
  issues: PrgValidationIssue[],
) {
  if (getSerializedType(item) !== "Section" || item.children === undefined) {
    return;
  }

  if (!Array.isArray(item.children)) {
    issues.push({
      severity: "error",
      code: "invalid_section_children",
      message: `Section at index ${index} has a non-array children value.`,
      path: `/stage/${index}/children`,
    });
    return;
  }

  item.children.forEach((child, childIndex) => {
    const resolved = resolveSerializedRef(rootStage, child);
    const uuid = isRecord(resolved) && typeof resolved.uuid === "string" ? resolved.uuid : undefined;
    if (!uuid || !uuids.has(uuid)) {
      issues.push({
        severity: "error",
        code: "missing_section_child",
        message: `Section at index ${index} references a missing child at children[${childIndex}].`,
        path: `/stage/${index}/children/${childIndex}`,
      });
    }
  });
}

function validateAttachmentReference(
  attachments: Map<string, PrgAttachment>,
  item: RecordValue,
  index: number,
  issues: PrgValidationIssue[],
) {
  const type = getSerializedType(item);
  if (type !== "ImageNode" && type !== "SvgNode" && type !== "ReferenceBlockNode") {
    return;
  }
  if (typeof item.attachmentId !== "string") {
    issues.push({
      severity: "warning",
      code: "missing_attachment_id",
      message: `${type} at index ${index} does not have an attachmentId.`,
      path: `/stage/${index}/attachmentId`,
    });
    return;
  }
  if (!attachments.has(item.attachmentId)) {
    issues.push({
      severity: "error",
      code: "missing_attachment",
      message: `${type} at index ${index} references missing attachment ${item.attachmentId}.`,
      path: `/stage/${index}/attachmentId`,
    });
  }
}

function resolveSerializedRef(root: unknown, value: unknown): unknown {
  if (isRecord(value) && typeof value.$ === "string") {
    return getBySerializedPath(root, value.$);
  }
  return value;
}

function getBySerializedPath(root: unknown, path: string): unknown {
  if (path === "") {
    return root;
  }
  const segments = path.split("/").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function getSerializedType(value: unknown): string {
  return isRecord(value) && typeof value._ === "string" ? value._ : "Unknown";
}

function isAssociationType(type: string): boolean {
  return (
    type === "LineEdge" ||
    type === "ArcEdge" ||
    type === "CubicCatmullRomSplineEdge" ||
    type === "MultiTargetUndirectedEdge" ||
    type === "SyncAssociation"
  );
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
