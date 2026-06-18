import type { PrgArchive, PrgAttachment, PrgMetadata, PrgReferences } from "@graphif/prg-codec";

export * from "./opsSchema";

export const PGJSON_SCHEMA_VERSION = "0.1" as const;

export interface PgJsonColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PgJsonNode {
  id: string;
  type: "text" | "image" | "svg";
  text: string;
  detailsMarkdown: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: PgJsonColor;
  section: string | null;
  attachmentId?: string;
  scale?: number;
  isBackground?: boolean;
}

export interface PgJsonSection {
  id: string;
  text: string;
  detailsMarkdown: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: PgJsonColor;
  children: string[];
  section: string | null;
  collapsed: boolean;
  locked: boolean;
}

export interface PgJsonEdge {
  id: string;
  type: "line";
  source: string;
  target: string;
  text: string;
  lineType: string;
  color: PgJsonColor;
}

export interface PgJsonAttachment {
  id: string;
  extension: string;
  path: string;
  dataBase64?: string;
}

export interface PgJsonUnsupportedObject {
  id?: string;
  type: string;
  index: number;
  raw: unknown;
}

export interface PgJsonDocument {
  schemaVersion: typeof PGJSON_SCHEMA_VERSION;
  prgVersion: string;
  nodes: PgJsonNode[];
  sections: PgJsonSection[];
  edges: PgJsonEdge[];
  tags: string[];
  attachments: PgJsonAttachment[];
  unsupportedObjects: PgJsonUnsupportedObject[];
  warnings: string[];
}

export interface ProjectGraphPatch {
  baseRevision?: number;
  ops: ProjectGraphOperation[];
}

export type ProjectGraphOperation =
  | {
      op: "add_text_node";
      id?: string;
      text: string;
      position?: PgJsonPoint;
      size?: PgJsonSize;
      detailsMarkdown?: string;
      color?: PgJsonColor;
      section?: string;
    }
  | { op: "rename_node"; id: string; text: string }
  | { op: "set_node_details_markdown"; id: string; markdown: string }
  | { op: "move_node"; id: string; position: PgJsonPoint }
  | { op: "resize_node"; id: string; size: PgJsonSize }
  | {
      op: "add_section";
      id?: string;
      text: string;
      position?: PgJsonPoint;
      size?: PgJsonSize;
      detailsMarkdown?: string;
      color?: PgJsonColor;
      collapsed?: boolean;
      locked?: boolean;
      children?: string[];
      section?: string;
    }
  | { op: "set_section_text"; id: string; text: string }
  | { op: "set_section_details_markdown"; id: string; markdown: string }
  | { op: "set_section_collapsed"; id: string; collapsed: boolean }
  | { op: "set_section_locked"; id: string; locked: boolean }
  | { op: "set_section_children"; id: string; children: string[] }
  | { op: "add_to_section"; id: string; children: string[] }
  | { op: "remove_from_section"; id: string; children: string[] }
  | {
      op: "add_image_node";
      id?: string;
      attachmentId?: string;
      dataBase64: string;
      extension?: string;
      path?: string;
      position?: PgJsonPoint;
      size?: PgJsonSize;
      scale?: number;
      isBackground?: boolean;
      detailsMarkdown?: string;
      section?: string;
    }
  | {
      op: "add_svg_node";
      id?: string;
      attachmentId?: string;
      dataBase64: string;
      extension?: string;
      path?: string;
      position?: PgJsonPoint;
      size?: PgJsonSize;
      scale?: number;
      color?: PgJsonColor;
      detailsMarkdown?: string;
      section?: string;
    }
  | {
      op: "connect";
      id?: string;
      source: string;
      target: string;
      text?: string;
      lineType?: string;
      color?: PgJsonColor;
    }
  | { op: "set_edge_text"; id: string; text: string }
  | { op: "set_edge_style"; id: string; text?: string; lineType?: string; color?: PgJsonColor }
  | { op: "move_objects"; ids: string[]; delta: PgJsonPoint }
  | {
      op: "layout_grid";
      ids?: string[];
      origin?: PgJsonPoint;
      columns?: number;
      gap?: PgJsonSize;
      cell?: PgJsonSize;
    }
  | { op: "delete_object"; id: string }
  | { op: "set_color"; id: string; color: PgJsonColor }
  | { op: "import_markdown"; markdown: string; origin?: PgJsonPoint }
  | { op: "import_mermaid"; mermaid: string; origin?: PgJsonPoint };

export interface PgJsonPoint {
  x: number;
  y: number;
}

export interface PgJsonSize {
  width: number;
  height: number;
}

export interface ProjectGraphPatchResult {
  archive: PrgArchive;
  changed: string[];
  warnings: string[];
}

export type ProjectGraphQueryKind = "all" | "node" | "section" | "edge" | "attachment" | "unsupported";

export interface ProjectGraphQuery {
  kind?: ProjectGraphQueryKind;
  id?: string;
  text?: string;
  section?: string | null;
  limit?: number;
  includeUnsupported?: boolean;
}

export interface ProjectGraphQueryItem {
  kind: Exclude<ProjectGraphQueryKind, "all">;
  id: string | null;
  type: string;
  text?: string;
  detailsMarkdown?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  section?: string | null;
  source?: string;
  target?: string;
  attachmentId?: string;
  path?: string;
}

export interface ProjectGraphQueryResult {
  items: ProjectGraphQueryItem[];
  total: number;
}

export interface ProjectGraphValidationIssue {
  path: string;
  message: string;
}

export interface ProjectGraphValidationResult {
  ok: boolean;
  issues: ProjectGraphValidationIssue[];
}

interface MarkdownNode {
  title: string;
  content: string;
  children: MarkdownNode[];
}

interface MermaidNodeToken {
  id: string;
  label?: string;
}

type RecordValue = Record<string, unknown>;

const TEXT_NODE_WIDTH = 160;
const TEXT_NODE_HEIGHT = 72;
const MARKDOWN_X_SPACING = 260;
const MARKDOWN_Y_SPACING = 140;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64_ALPHABET].map((char, index) => [char, index]));

export function archiveToPgJson(archive: PrgArchive): PgJsonDocument {
  const warnings: string[] = [];
  const sectionChildren = new Map<string, Set<string>>();
  const objectToSection = new Map<string, string>();

  for (const item of archive.stage) {
    if (getSerializedType(item) !== "Section" || !isRecord(item) || typeof item.uuid !== "string") {
      continue;
    }
    const children = resolveObjectList(item.children, archive.stage)
      .map((child) => getUuid(child))
      .filter((id): id is string => Boolean(id));
    sectionChildren.set(item.uuid, new Set(children));
    for (const childId of children) {
      objectToSection.set(childId, item.uuid);
    }
  }

  const nodes: PgJsonNode[] = [];
  const sections: PgJsonSection[] = [];
  const edges: PgJsonEdge[] = [];
  const unsupportedObjects: PgJsonUnsupportedObject[] = [];

  archive.stage.forEach((item, index) => {
    const type = getSerializedType(item);
    if (!isRecord(item)) {
      unsupportedObjects.push({ type, index, raw: cloneValue(item) });
      warnings.push(`Stage item ${index} is not an object and was preserved as unsupported.`);
      return;
    }

    const id = typeof item.uuid === "string" ? item.uuid : undefined;
    if (type === "TextNode" && id) {
      const rect = getStageObjectRectangle(item);
      nodes.push({
        id,
        type: "text",
        text: getString(item.text),
        detailsMarkdown: detailsToMarkdown(item.details),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: normalizeColor(item.color),
        section: objectToSection.get(id) ?? null,
      });
      return;
    }

    if ((type === "ImageNode" || type === "SvgNode") && id) {
      const rect = getStageObjectRectangle(item);
      nodes.push({
        id,
        type: type === "ImageNode" ? "image" : "svg",
        text: "",
        detailsMarkdown: detailsToMarkdown(item.details),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: normalizeColor(item.color),
        section: objectToSection.get(id) ?? null,
        attachmentId: getString(item.attachmentId) || undefined,
        scale: getNumber(item.scale, 1),
        isBackground: item.isBackground === true,
      });
      return;
    }

    if (type === "Section" && id) {
      const rect = getStageObjectRectangle(item);
      sections.push({
        id,
        text: getString(item.text),
        detailsMarkdown: detailsToMarkdown(item.details),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: normalizeColor(item.color),
        children: [...(sectionChildren.get(id) ?? new Set<string>())],
        section: objectToSection.get(id) ?? null,
        collapsed: item.isCollapsed === true,
        locked: item.locked === true,
      });
      return;
    }

    if (type === "LineEdge" && id) {
      const [source, target] = resolveObjectList(item.associationList, archive.stage);
      const sourceId = getUuid(source);
      const targetId = getUuid(target);
      if (!sourceId || !targetId) {
        warnings.push(`LineEdge ${id} has unresolved endpoints and was preserved as unsupported.`);
        unsupportedObjects.push({ id, type, index, raw: cloneValue(item) });
        return;
      }
      edges.push({
        id,
        type: "line",
        source: sourceId,
        target: targetId,
        text: getString(item.text),
        lineType: getString(item.lineType) || "solid",
        color: normalizeColor(item.color),
      });
      return;
    }

    unsupportedObjects.push({ id, type, index, raw: cloneValue(item) });
    warnings.push(`Stage object ${id ?? index} of type ${type} is not mapped into pgjson.`);
  });

  return {
    schemaVersion: PGJSON_SCHEMA_VERSION,
    prgVersion: archive.metadata.version,
    nodes,
    sections,
    edges,
    tags: [...archive.tags],
    attachments: [...archive.attachments.values()].map((attachment) => ({
      id: attachment.id,
      extension: attachment.extension,
      path: attachment.path,
      dataBase64: encodeBase64(attachment.data),
    })),
    unsupportedObjects,
    warnings,
  };
}

export function pgJsonToArchive(document: PgJsonDocument, baseArchive?: PrgArchive): PrgArchive {
  const stage: unknown[] = [];
  const idToIndex = new Map<string, number>();

  const addObject = (object: RecordValue) => {
    const id = getUuid(object);
    if (id) {
      if (idToIndex.has(id)) {
        throw new Error(`Duplicate object id in pgjson: ${id}`);
      }
      idToIndex.set(id, stage.length);
    }
    stage.push(object);
  };

  for (const node of document.nodes) {
    if (node.type === "image") {
      addObject(
        createImageNode(node.id, node.attachmentId ?? "", node.x, node.y, node.width, node.height, {
          detailsMarkdown: node.detailsMarkdown,
          isBackground: node.isBackground,
          scale: node.scale,
        }),
      );
    } else if (node.type === "svg") {
      addObject(
        createSvgNode(node.id, node.attachmentId ?? "", node.x, node.y, node.width, node.height, {
          color: node.color,
          detailsMarkdown: node.detailsMarkdown,
          scale: node.scale,
        }),
      );
    } else {
      addObject(
        createTextNode(node.id, node.text, node.x, node.y, node.width, node.height, {
          color: node.color,
          detailsMarkdown: node.detailsMarkdown,
        }),
      );
    }
  }

  const sectionObjects: Array<{ section: PgJsonSection; object: RecordValue }> = [];
  for (const section of document.sections) {
    const object = createSection(section.id, section.text, section.x, section.y, section.width, section.height, {
      color: section.color,
      detailsMarkdown: section.detailsMarkdown,
      collapsed: section.collapsed,
      locked: section.locked,
    });
    addObject(object);
    sectionObjects.push({ section, object });
  }

  for (const unsupported of document.unsupportedObjects) {
    addObject(cloneValue(unsupported.raw) as RecordValue);
  }

  for (const { section, object } of sectionObjects) {
    const children = new Set(section.children);
    for (const node of document.nodes) {
      if (node.section === section.id) {
        children.add(node.id);
      }
    }
    for (const nested of document.sections) {
      if (nested.section === section.id) {
        children.add(nested.id);
      }
    }
    object.children = [...children].map((id) => refFromId(idToIndex, id));
  }

  const baseAttachments = cloneAttachmentMap(baseArchive?.attachments);
  const attachments = new Map<string, PrgAttachment>();
  for (const attachment of document.attachments) {
    const existing = baseAttachments.get(attachment.id);
    if (attachment.dataBase64 !== undefined) {
      attachments.set(attachment.id, {
        id: attachment.id,
        extension: attachment.extension,
        path: attachment.path,
        data: decodeBase64(attachment.dataBase64),
      });
    } else if (existing) {
      attachments.set(attachment.id, {
        ...existing,
        extension: attachment.extension,
        path: attachment.path,
        data: new Uint8Array(existing.data),
      });
    }
  }

  for (const [id, attachment] of baseAttachments.entries()) {
    if (!attachments.has(id)) {
      attachments.set(id, {
        ...attachment,
        data: new Uint8Array(attachment.data),
      });
    }
  }
  for (const edge of document.edges) {
    addObject(
      createLineEdge(edge.id, refFromId(idToIndex, edge.source), refFromId(idToIndex, edge.target), {
        text: edge.text,
        lineType: edge.lineType,
        color: edge.color,
      }),
    );
  }

  return {
    metadata: normalizeMetadata(baseArchive?.metadata, document.prgVersion),
    tags: [...document.tags],
    references: cloneReferences(baseArchive?.references),
    readme: baseArchive?.readme,
    stage,
    attachments,
    thumbnail: baseArchive?.thumbnail ? new Uint8Array(baseArchive.thumbnail) : undefined,
    extraEntries: cloneUint8Map(baseArchive?.extraEntries),
  };
}

export function applyOperationsToArchive(archive: PrgArchive, patch: ProjectGraphPatch): ProjectGraphPatchResult {
  assertValidProjectGraphPatchPayload(patch);
  const output = cloneArchive(archive);
  const changed = new Set<string>();
  const warnings: string[] = [];

  for (const op of patch.ops) {
    applyOperation(output, op, changed, warnings);
  }

  return {
    archive: output,
    changed: [...changed],
    warnings,
  };
}

export function exportPgJson(archive: PrgArchive): string {
  return JSON.stringify(archiveToPgJson(archive), null, 2);
}

export function queryArchive(archive: PrgArchive, query: ProjectGraphQuery = {}): ProjectGraphQueryResult {
  const document = archiveToPgJson(archive);
  const kind = query.kind ?? "all";
  const text = query.text?.toLowerCase();
  const items: ProjectGraphQueryItem[] = [];

  const matchesText = (value: string | undefined) => !text || (value ?? "").toLowerCase().includes(text);
  const matchesId = (id: string | null) => !query.id || id === query.id;
  const matchesSection = (section: string | null | undefined) =>
    query.section === undefined || section === query.section;

  if (kind === "all" || kind === "node") {
    for (const node of document.nodes) {
      if (
        matchesId(node.id) &&
        matchesText(`${node.text}\n${node.detailsMarkdown}\n${node.attachmentId ?? ""}`) &&
        matchesSection(node.section)
      ) {
        items.push({
          kind: "node",
          id: node.id,
          type: node.type,
          text: node.text,
          detailsMarkdown: node.detailsMarkdown,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          section: node.section,
          attachmentId: node.attachmentId,
        });
      }
    }
  }

  if (kind === "all" || kind === "section") {
    for (const section of document.sections) {
      if (
        matchesId(section.id) &&
        matchesText(`${section.text}\n${section.detailsMarkdown}`) &&
        matchesSection(section.section)
      ) {
        items.push({
          kind: "section",
          id: section.id,
          type: "section",
          text: section.text,
          detailsMarkdown: section.detailsMarkdown,
          x: section.x,
          y: section.y,
          width: section.width,
          height: section.height,
          section: section.section,
        });
      }
    }
  }

  if (kind === "all" || kind === "edge") {
    for (const edge of document.edges) {
      if (matchesId(edge.id) && matchesText(edge.text)) {
        items.push({
          kind: "edge",
          id: edge.id,
          type: edge.type,
          text: edge.text,
          source: edge.source,
          target: edge.target,
        });
      }
    }
  }

  if (kind === "all" || kind === "attachment") {
    for (const attachment of document.attachments) {
      if (matchesId(attachment.id) && matchesText(`${attachment.id}\n${attachment.path}`)) {
        items.push({
          kind: "attachment",
          id: attachment.id,
          type: attachment.extension,
          path: attachment.path,
        });
      }
    }
  }

  if (query.includeUnsupported || kind === "unsupported") {
    for (const unsupported of document.unsupportedObjects) {
      const id = unsupported.id ?? null;
      if (matchesId(id) && matchesText(`${unsupported.type}\n${id ?? ""}`)) {
        items.push({
          kind: "unsupported",
          id,
          type: unsupported.type,
        });
      }
    }
  }

  const total = items.length;
  return {
    items: typeof query.limit === "number" ? items.slice(0, query.limit) : items,
    total,
  };
}

export function validateProjectGraphPatchPayload(payload: unknown): ProjectGraphValidationResult {
  const issues: ProjectGraphValidationIssue[] = [];
  const ops = getPatchOpsForValidation(payload, issues);
  ops?.forEach((operation, index) => validateOperationPayload(operation, `$.ops[${index}]`, issues));
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function assertValidProjectGraphPatchPayload(payload: unknown): asserts payload is ProjectGraphPatch {
  const result = validateProjectGraphPatchPayload(payload);
  if (!result.ok) {
    throw new Error(`Invalid Project Graph patch payload: ${formatValidationIssues(result.issues)}`);
  }
}

function getPatchOpsForValidation(payload: unknown, issues: ProjectGraphValidationIssue[]): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    addIssue(issues, "$", "must be an operation array or an object with an ops array");
    return undefined;
  }
  validateAllowedKeys(payload, "$", ["baseRevision", "ops"], issues);
  validateOptionalInteger(payload, "baseRevision", "$.baseRevision", issues);
  if (!Array.isArray(payload.ops)) {
    addIssue(issues, "$.ops", "must be an array");
    return undefined;
  }
  return payload.ops;
}

function validateOperationPayload(value: unknown, path: string, issues: ProjectGraphValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object");
    return;
  }
  if (typeof value.op !== "string") {
    addIssue(issues, `${path}.op`, "must be a string");
    return;
  }

  switch (value.op) {
    case "add_text_node":
      validateAllowedKeys(
        value,
        path,
        ["op", "id", "text", "position", "size", "detailsMarkdown", "color", "section"],
        issues,
      );
      validateOptionalObjectId(value, "id", `${path}.id`, issues);
      validateRequiredString(value, "text", `${path}.text`, issues);
      validateOptionalPoint(value, "position", `${path}.position`, issues);
      validateOptionalSize(value, "size", `${path}.size`, issues);
      validateOptionalString(value, "detailsMarkdown", `${path}.detailsMarkdown`, issues);
      validateOptionalColor(value, "color", `${path}.color`, issues);
      validateOptionalObjectId(value, "section", `${path}.section`, issues);
      return;
    case "rename_node":
    case "set_edge_text":
    case "set_section_text":
      validateAllowedKeys(value, path, ["op", "id", "text"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredString(value, "text", `${path}.text`, issues);
      return;
    case "set_node_details_markdown":
    case "set_section_details_markdown":
      validateAllowedKeys(value, path, ["op", "id", "markdown"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredString(value, "markdown", `${path}.markdown`, issues);
      return;
    case "move_node":
      validateAllowedKeys(value, path, ["op", "id", "position"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredPoint(value, "position", `${path}.position`, issues);
      return;
    case "resize_node":
      validateAllowedKeys(value, path, ["op", "id", "size"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredSize(value, "size", `${path}.size`, issues);
      return;
    case "add_section":
      validateAllowedKeys(
        value,
        path,
        [
          "op",
          "id",
          "text",
          "position",
          "size",
          "detailsMarkdown",
          "color",
          "collapsed",
          "locked",
          "children",
          "section",
        ],
        issues,
      );
      validateOptionalObjectId(value, "id", `${path}.id`, issues);
      validateRequiredString(value, "text", `${path}.text`, issues);
      validateOptionalPoint(value, "position", `${path}.position`, issues);
      validateOptionalSize(value, "size", `${path}.size`, issues);
      validateOptionalString(value, "detailsMarkdown", `${path}.detailsMarkdown`, issues);
      validateOptionalColor(value, "color", `${path}.color`, issues);
      validateOptionalBoolean(value, "collapsed", `${path}.collapsed`, issues);
      validateOptionalBoolean(value, "locked", `${path}.locked`, issues);
      validateOptionalObjectIdArray(value, "children", `${path}.children`, issues);
      validateOptionalObjectId(value, "section", `${path}.section`, issues);
      return;
    case "set_section_collapsed":
      validateAllowedKeys(value, path, ["op", "id", "collapsed"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredBoolean(value, "collapsed", `${path}.collapsed`, issues);
      return;
    case "set_section_locked":
      validateAllowedKeys(value, path, ["op", "id", "locked"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredBoolean(value, "locked", `${path}.locked`, issues);
      return;
    case "set_section_children":
    case "add_to_section":
    case "remove_from_section":
      validateAllowedKeys(value, path, ["op", "id", "children"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredObjectIdArray(value, "children", `${path}.children`, issues);
      return;
    case "add_image_node":
      validateAttachmentNodeOperation(
        value,
        path,
        [
          "op",
          "id",
          "attachmentId",
          "dataBase64",
          "extension",
          "path",
          "position",
          "size",
          "scale",
          "isBackground",
          "detailsMarkdown",
          "section",
        ],
        issues,
      );
      validateOptionalBoolean(value, "isBackground", `${path}.isBackground`, issues);
      return;
    case "add_svg_node":
      validateAttachmentNodeOperation(
        value,
        path,
        [
          "op",
          "id",
          "attachmentId",
          "dataBase64",
          "extension",
          "path",
          "position",
          "size",
          "scale",
          "color",
          "detailsMarkdown",
          "section",
        ],
        issues,
      );
      validateOptionalColor(value, "color", `${path}.color`, issues);
      return;
    case "connect":
      validateAllowedKeys(value, path, ["op", "id", "source", "target", "text", "lineType", "color"], issues);
      validateOptionalObjectId(value, "id", `${path}.id`, issues);
      validateRequiredObjectId(value, "source", `${path}.source`, issues);
      validateRequiredObjectId(value, "target", `${path}.target`, issues);
      validateOptionalString(value, "text", `${path}.text`, issues);
      validateOptionalString(value, "lineType", `${path}.lineType`, issues);
      validateOptionalColor(value, "color", `${path}.color`, issues);
      return;
    case "set_edge_style":
      validateAllowedKeys(value, path, ["op", "id", "text", "lineType", "color"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateOptionalString(value, "text", `${path}.text`, issues);
      validateOptionalString(value, "lineType", `${path}.lineType`, issues);
      validateOptionalColor(value, "color", `${path}.color`, issues);
      return;
    case "move_objects":
      validateAllowedKeys(value, path, ["op", "ids", "delta"], issues);
      validateRequiredObjectIdArray(value, "ids", `${path}.ids`, issues);
      validateRequiredPoint(value, "delta", `${path}.delta`, issues);
      return;
    case "layout_grid":
      validateAllowedKeys(value, path, ["op", "ids", "origin", "columns", "gap", "cell"], issues);
      validateOptionalObjectIdArray(value, "ids", `${path}.ids`, issues);
      validateOptionalPoint(value, "origin", `${path}.origin`, issues);
      validateOptionalPositiveInteger(value, "columns", `${path}.columns`, issues);
      validateOptionalSize(value, "gap", `${path}.gap`, issues);
      validateOptionalSize(value, "cell", `${path}.cell`, issues);
      return;
    case "delete_object":
      validateAllowedKeys(value, path, ["op", "id"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      return;
    case "set_color":
      validateAllowedKeys(value, path, ["op", "id", "color"], issues);
      validateRequiredObjectId(value, "id", `${path}.id`, issues);
      validateRequiredColor(value, "color", `${path}.color`, issues);
      return;
    case "import_markdown":
      validateAllowedKeys(value, path, ["op", "markdown", "origin"], issues);
      validateRequiredString(value, "markdown", `${path}.markdown`, issues);
      validateOptionalPoint(value, "origin", `${path}.origin`, issues);
      return;
    case "import_mermaid":
      validateAllowedKeys(value, path, ["op", "mermaid", "origin"], issues);
      validateRequiredString(value, "mermaid", `${path}.mermaid`, issues);
      validateOptionalPoint(value, "origin", `${path}.origin`, issues);
      return;
    default:
      addIssue(issues, `${path}.op`, `unsupported operation: ${value.op}`);
  }
}

function validateAttachmentNodeOperation(
  value: RecordValue,
  path: string,
  allowedKeys: string[],
  issues: ProjectGraphValidationIssue[],
): void {
  validateAllowedKeys(value, path, allowedKeys, issues);
  validateOptionalObjectId(value, "id", `${path}.id`, issues);
  validateOptionalObjectId(value, "attachmentId", `${path}.attachmentId`, issues);
  validateRequiredString(value, "dataBase64", `${path}.dataBase64`, issues);
  validateOptionalString(value, "extension", `${path}.extension`, issues);
  validateOptionalString(value, "path", `${path}.path`, issues);
  validateOptionalPoint(value, "position", `${path}.position`, issues);
  validateOptionalSize(value, "size", `${path}.size`, issues);
  validateOptionalPositiveNumber(value, "scale", `${path}.scale`, issues);
  validateOptionalString(value, "detailsMarkdown", `${path}.detailsMarkdown`, issues);
  validateOptionalObjectId(value, "section", `${path}.section`, issues);
}

function validateAllowedKeys(
  value: RecordValue,
  path: string,
  allowedKeys: string[],
  issues: ProjectGraphValidationIssue[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(issues, `${path}.${key}`, "is not allowed");
    }
  }
}

function validateRequiredString(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (typeof value[key] !== "string") {
    addIssue(issues, path, "must be a string");
  }
}

function validateOptionalString(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] !== undefined && typeof value[key] !== "string") {
    addIssue(issues, path, "must be a string");
  }
}

function validateRequiredObjectId(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  validateRequiredString(value, key, path, issues);
  if (typeof value[key] === "string" && value[key].length === 0) {
    addIssue(issues, path, "must not be empty");
  }
}

function validateOptionalObjectId(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  validateOptionalString(value, key, path, issues);
  if (typeof value[key] === "string" && value[key].length === 0) {
    addIssue(issues, path, "must not be empty");
  }
}

function validateRequiredObjectIdArray(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (!Array.isArray(value[key])) {
    addIssue(issues, path, "must be an array");
    return;
  }
  validateObjectIdArrayItems(value[key], path, issues);
}

function validateOptionalObjectIdArray(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] === undefined) {
    return;
  }
  if (!Array.isArray(value[key])) {
    addIssue(issues, path, "must be an array");
    return;
  }
  validateObjectIdArrayItems(value[key], path, issues);
}

function validateObjectIdArrayItems(values: unknown[], path: string, issues: ProjectGraphValidationIssue[]): void {
  values.forEach((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      addIssue(issues, `${path}[${index}]`, "must be a non-empty string");
    }
  });
}

function validateRequiredBoolean(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (typeof value[key] !== "boolean") {
    addIssue(issues, path, "must be a boolean");
  }
}

function validateOptionalBoolean(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] !== undefined && typeof value[key] !== "boolean") {
    addIssue(issues, path, "must be a boolean");
  }
}

function validateOptionalInteger(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] !== undefined && !Number.isInteger(value[key])) {
    addIssue(issues, path, "must be an integer");
  }
}

function validateOptionalPositiveInteger(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] === undefined) {
    return;
  }
  if (!Number.isInteger(value[key]) || (value[key] as number) < 1) {
    addIssue(issues, path, "must be a positive integer");
  }
}

function validateOptionalPositiveNumber(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] <= 0)) {
    addIssue(issues, path, "must be a positive number");
  }
}

function validateRequiredPoint(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (!isRecord(value[key])) {
    addIssue(issues, path, "must be an object");
    return;
  }
  validatePoint(value[key], path, issues);
}

function validateOptionalPoint(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] === undefined) {
    return;
  }
  validateRequiredPoint(value, key, path, issues);
}

function validatePoint(value: RecordValue, path: string, issues: ProjectGraphValidationIssue[]): void {
  validateAllowedKeys(value, path, ["x", "y"], issues);
  validateRequiredFiniteNumber(value, "x", `${path}.x`, issues);
  validateRequiredFiniteNumber(value, "y", `${path}.y`, issues);
}

function validateRequiredSize(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (!isRecord(value[key])) {
    addIssue(issues, path, "must be an object");
    return;
  }
  validateSize(value[key], path, issues);
}

function validateOptionalSize(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] === undefined) {
    return;
  }
  validateRequiredSize(value, key, path, issues);
}

function validateSize(value: RecordValue, path: string, issues: ProjectGraphValidationIssue[]): void {
  validateAllowedKeys(value, path, ["width", "height"], issues);
  validateRequiredPositiveNumber(value, "width", `${path}.width`, issues);
  validateRequiredPositiveNumber(value, "height", `${path}.height`, issues);
}

function validateRequiredColor(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (!isRecord(value[key])) {
    addIssue(issues, path, "must be an object");
    return;
  }
  validateColor(value[key], path, issues);
}

function validateOptionalColor(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (value[key] === undefined) {
    return;
  }
  validateRequiredColor(value, key, path, issues);
}

function validateColor(value: RecordValue, path: string, issues: ProjectGraphValidationIssue[]): void {
  validateAllowedKeys(value, path, ["r", "g", "b", "a"], issues);
  for (const key of ["r", "g", "b", "a"]) {
    validateRequiredFiniteNumber(value, key, `${path}.${key}`, issues);
  }
}

function validateRequiredFiniteNumber(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
    addIssue(issues, path, "must be a finite number");
  }
}

function validateRequiredPositiveNumber(
  value: RecordValue,
  key: string,
  path: string,
  issues: ProjectGraphValidationIssue[],
): void {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] <= 0) {
    addIssue(issues, path, "must be a positive number");
  }
}

function addIssue(issues: ProjectGraphValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function formatValidationIssues(issues: ProjectGraphValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

export function exportMarkdown(archive: PrgArchive, rootId?: string): string {
  const document = archiveToPgJson(archive);
  const nodesById = new Map(document.nodes.filter(isTextPgJsonNode).map((node) => [node.id, node]));
  const outgoing = new Map<string, PgJsonEdge[]>();
  const incoming = new Set<string>();

  for (const edge of document.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      continue;
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.add(edge.target);
  }

  const roots = rootId
    ? [nodesById.get(rootId)].filter((node): node is PgJsonNode => Boolean(node))
    : document.nodes.filter((node) => !incoming.has(node.id));
  const visited = new Set<string>();
  const lines: string[] = [];

  const visit = (node: PgJsonNode, depth: number) => {
    if (visited.has(node.id)) {
      lines.push(`${"#".repeat(Math.min(depth, 6))} ${node.text || node.id} (cycle)`);
      lines.push("");
      return;
    }
    visited.add(node.id);
    const heading = depth <= 6 ? "#".repeat(depth) : "######";
    lines.push(`${heading} ${node.text || node.id}`);
    lines.push("");
    if (node.detailsMarkdown.trim()) {
      lines.push(node.detailsMarkdown.trim());
      lines.push("");
    }
    const childEdges = (outgoing.get(node.id) ?? []).sort((a, b) => a.target.localeCompare(b.target));
    for (const edge of childEdges) {
      const target = nodesById.get(edge.target);
      if (target) {
        visit(target, depth + 1);
      }
    }
  };

  for (const root of roots) {
    visit(root, 1);
  }

  return lines.join("\n").trimEnd() + "\n";
}

function isTextPgJsonNode(node: PgJsonNode): boolean {
  return node.type === "text";
}

export function exportMermaid(archive: PrgArchive): string {
  const document = archiveToPgJson(archive);
  const nodeIdMap = new Map<string, string>();
  const sectionChildren = new Map(document.sections.map((section) => [section.id, new Set(section.children)]));
  const sectionById = new Map(document.sections.map((section) => [section.id, section]));
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));

  const getMermaidId = (id: string) => {
    const existing = nodeIdMap.get(id);
    if (existing) {
      return existing;
    }
    const next = `id${nodeIdMap.size}`;
    nodeIdMap.set(id, next);
    return next;
  };

  const lines = ["graph TD"];
  const emitted = new Set<string>();

  const emitItem = (id: string, indent: string) => {
    if (emitted.has(id)) {
      return;
    }
    emitted.add(id);
    const section = sectionById.get(id);
    if (section) {
      lines.push(`${indent}subgraph ${getMermaidId(section.id)}["${escapeMermaidText(section.text || "Section")}"]`);
      for (const childId of sectionChildren.get(section.id) ?? []) {
        emitItem(childId, `${indent}  `);
      }
      lines.push(`${indent}end`);
      return;
    }

    const node = nodeById.get(id);
    if (node) {
      const mermaidId = getMermaidId(node.id);
      lines.push(node.text ? `${indent}${mermaidId}["${escapeMermaidText(node.text)}"]` : `${indent}${mermaidId}`);
    }
  };

  for (const section of document.sections.filter((section) => section.section === null)) {
    emitItem(section.id, "");
  }
  for (const node of document.nodes.filter((node) => node.section === null)) {
    emitItem(node.id, "");
  }
  for (const node of document.nodes) {
    emitItem(node.id, "");
  }

  for (const edge of document.edges) {
    const sourceId = getMermaidId(edge.source);
    const targetId = getMermaidId(edge.target);
    const arrow = edge.lineType === "dashed" ? "-.->" : edge.lineType === "double" ? "==>" : "-->";
    if (edge.text.trim()) {
      lines.push(`${sourceId} -- "${escapeMermaidText(edge.text)}" --> ${targetId}`);
    } else {
      lines.push(`${sourceId} ${arrow} ${targetId}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function importMarkdown(
  markdown: string,
  options: { origin?: PgJsonPoint; prgVersion?: string } = {},
): PrgArchive {
  const parsed = parseMarkdown(markdown);
  const document = createEmptyPgJson(options.prgVersion);
  let yIndex = 0;

  const addNode = (node: MarkdownNode, depth: number, parentId?: string) => {
    const id = uniqueId(slugify(node.title || "node"), new Set([...document.nodes.map((item) => item.id)]));
    const origin = options.origin ?? { x: 0, y: 0 };
    document.nodes.push({
      id,
      type: "text",
      text: node.title,
      detailsMarkdown: node.content,
      x: origin.x + depth * MARKDOWN_X_SPACING,
      y: origin.y + yIndex * MARKDOWN_Y_SPACING,
      width: TEXT_NODE_WIDTH,
      height: TEXT_NODE_HEIGHT,
      color: transparentColor(),
      section: null,
    });
    yIndex++;

    if (parentId) {
      document.edges.push({
        id: uniqueId(`edge-${parentId}-${id}`, new Set(document.edges.map((edge) => edge.id))),
        type: "line",
        source: parentId,
        target: id,
        text: "",
        lineType: "solid",
        color: transparentColor(),
      });
    }

    for (const child of node.children) {
      addNode(child, depth + 1, id);
    }
  };

  for (const root of parsed) {
    addNode(root, 0);
  }

  return pgJsonToArchive(document);
}

export function importMermaid(
  mermaid: string,
  options: { origin?: PgJsonPoint; prgVersion?: string } = {},
): PrgArchive {
  const document = createEmptyPgJson(options.prgVersion);
  const idSet = new Set<string>();
  const mermaidIdMap = new Map<string, string>();
  const sectionStack: string[] = [];
  const parentById = new Map<string, string>();
  let nodeIndex = 0;

  const ensureNode = (token: string, forceSection = false): string => {
    const parsed = parseMermaidNodeToken(token);
    const existing = mermaidIdMap.get(parsed.id);
    if (existing) {
      return existing;
    }
    const id = uniqueId(slugify(parsed.id), idSet);
    const origin = options.origin ?? { x: 0, y: 0 };
    const parent = sectionStack.at(-1) ?? null;

    if (forceSection) {
      document.sections.push({
        id,
        text: parsed.label ?? parsed.id,
        detailsMarkdown: "",
        x: origin.x + sectionStack.length * MARKDOWN_X_SPACING,
        y: origin.y + nodeIndex * MARKDOWN_Y_SPACING,
        width: 260,
        height: 180,
        color: transparentColor(),
        children: [],
        section: parent,
        collapsed: false,
        locked: false,
      });
    } else {
      document.nodes.push({
        id,
        type: "text",
        text: parsed.label ?? parsed.id,
        detailsMarkdown: "",
        x: origin.x + sectionStack.length * MARKDOWN_X_SPACING,
        y: origin.y + nodeIndex * MARKDOWN_Y_SPACING,
        width: TEXT_NODE_WIDTH,
        height: TEXT_NODE_HEIGHT,
        color: transparentColor(),
        section: parent,
      });
    }

    if (parent) {
      const parentSection = document.sections.find((section) => section.id === parent);
      parentSection?.children.push(id);
      parentById.set(id, parent);
    }
    nodeIndex++;
    mermaidIdMap.set(parsed.id, id);
    return id;
  };

  const lines = mermaid
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim().replace(/;$/, ""))
    .filter((line) => line && !line.startsWith("```") && !line.startsWith("%%"));

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("graph ") || lower.startsWith("flowchart ")) {
      continue;
    }
    if (lower.startsWith("subgraph ")) {
      sectionStack.push(ensureNode(line.slice("subgraph ".length).trim(), true));
      continue;
    }
    if (lower === "end") {
      sectionStack.pop();
      continue;
    }

    const edge = parseMermaidEdge(line);
    if (edge) {
      const source = ensureNode(edge.source);
      const target = ensureNode(edge.target);
      document.edges.push({
        id: uniqueId(`edge-${source}-${target}`, new Set(document.edges.map((item) => item.id))),
        type: "line",
        source,
        target,
        text: edge.label ?? "",
        lineType: edge.lineType,
        color: transparentColor(),
      });
      continue;
    }

    ensureNode(line);
  }

  for (const section of document.sections) {
    const children = section.children
      .map((id) => document.nodes.find((node) => node.id === id) ?? document.sections.find((item) => item.id === id))
      .filter((item): item is PgJsonNode | PgJsonSection => Boolean(item));
    if (children.length > 0) {
      const bounds = boundingBox(children);
      section.x = bounds.x - 40;
      section.y = bounds.y - 80;
      section.width = Math.max(bounds.width + 80, section.width);
      section.height = Math.max(bounds.height + 120, section.height);
    }
  }

  for (const node of document.nodes) {
    if (node.section && !parentById.has(node.id)) {
      parentById.set(node.id, node.section);
    }
  }

  return pgJsonToArchive(document);
}

function applyOperation(
  archive: PrgArchive,
  op: ProjectGraphOperation,
  changed: Set<string>,
  warnings: string[],
): void {
  switch (op.op) {
    case "add_text_node": {
      const id = op.id ?? createId();
      ensureIdUnused(archive, id);
      const position = op.position ?? nextFreePosition(archive);
      const size = op.size ?? { width: TEXT_NODE_WIDTH, height: TEXT_NODE_HEIGHT };
      archive.stage.push(
        createTextNode(id, op.text, position.x, position.y, size.width, size.height, {
          color: op.color,
          detailsMarkdown: op.detailsMarkdown,
        }),
      );
      if (op.section) {
        addObjectIdsToSection(archive, op.section, [id], changed);
      }
      changed.add(id);
      return;
    }
    case "rename_node": {
      const object = findStageObjectById(archive, op.id);
      requireRecord(object, op.id).text = op.text;
      changed.add(op.id);
      return;
    }
    case "set_node_details_markdown": {
      const object = requireRecord(findStageObjectById(archive, op.id), op.id);
      object.details = markdownToDetails(op.markdown);
      changed.add(op.id);
      return;
    }
    case "move_node": {
      const object = requireRecord(findStageObjectById(archive, op.id), op.id);
      const rect = getStageObjectRectangle(object);
      setStageObjectRectangle(object, op.position.x, op.position.y, rect.width, rect.height);
      changed.add(op.id);
      return;
    }
    case "resize_node": {
      const object = requireRecord(findStageObjectById(archive, op.id), op.id);
      const rect = getStageObjectRectangle(object);
      setStageObjectRectangle(object, rect.x, rect.y, op.size.width, op.size.height);
      changed.add(op.id);
      return;
    }
    case "add_section": {
      const id = op.id ?? createId();
      ensureIdUnused(archive, id);
      const position = op.position ?? nextFreePosition(archive);
      const size = op.size ?? { width: 320, height: 220 };
      archive.stage.push(
        createSection(id, op.text, position.x, position.y, size.width, size.height, {
          color: op.color,
          detailsMarkdown: op.detailsMarkdown,
          collapsed: op.collapsed,
          locked: op.locked,
        }),
      );
      if (op.children?.length) {
        setSectionChildren(archive, id, op.children);
      }
      if (op.section) {
        addObjectIdsToSection(archive, op.section, [id], changed);
      }
      changed.add(id);
      return;
    }
    case "set_section_text": {
      const object = requireSectionRecord(archive, op.id);
      object.text = op.text;
      changed.add(op.id);
      return;
    }
    case "set_section_details_markdown": {
      const object = requireSectionRecord(archive, op.id);
      object.details = markdownToDetails(op.markdown);
      changed.add(op.id);
      return;
    }
    case "set_section_collapsed": {
      const object = requireSectionRecord(archive, op.id);
      object.isCollapsed = op.collapsed;
      changed.add(op.id);
      return;
    }
    case "set_section_locked": {
      const object = requireSectionRecord(archive, op.id);
      object.locked = op.locked;
      changed.add(op.id);
      return;
    }
    case "set_section_children": {
      setSectionChildren(archive, op.id, op.children);
      changed.add(op.id);
      return;
    }
    case "add_to_section": {
      addObjectIdsToSection(archive, op.id, op.children, changed);
      return;
    }
    case "remove_from_section": {
      removeObjectIdsFromSection(archive, op.id, op.children, changed);
      return;
    }
    case "add_image_node": {
      const id = op.id ?? createId();
      ensureIdUnused(archive, id);
      const attachmentId = addAttachmentFromOperation(archive, id, op);
      const position = op.position ?? nextFreePosition(archive);
      const size = op.size ?? { width: 240, height: 160 };
      archive.stage.push(
        createImageNode(id, attachmentId, position.x, position.y, size.width, size.height, {
          detailsMarkdown: op.detailsMarkdown,
          isBackground: op.isBackground,
          scale: op.scale,
        }),
      );
      if (op.section) {
        addObjectIdsToSection(archive, op.section, [id], changed);
      }
      changed.add(id);
      return;
    }
    case "add_svg_node": {
      const id = op.id ?? createId();
      ensureIdUnused(archive, id);
      const attachmentId = addAttachmentFromOperation(archive, id, { extension: "svg", ...op });
      const position = op.position ?? nextFreePosition(archive);
      const size = op.size ?? { width: 240, height: 160 };
      archive.stage.push(
        createSvgNode(id, attachmentId, position.x, position.y, size.width, size.height, {
          color: op.color,
          detailsMarkdown: op.detailsMarkdown,
          scale: op.scale,
        }),
      );
      if (op.section) {
        addObjectIdsToSection(archive, op.section, [id], changed);
      }
      changed.add(id);
      return;
    }
    case "connect": {
      const id = op.id ?? createId();
      ensureIdUnused(archive, id);
      const sourceRef = refForObjectId(archive, op.source);
      const targetRef = refForObjectId(archive, op.target);
      archive.stage.push(
        createLineEdge(id, sourceRef, targetRef, {
          text: op.text,
          lineType: op.lineType,
          color: op.color,
        }),
      );
      changed.add(id);
      return;
    }
    case "set_edge_text": {
      const object = requireRecord(findStageObjectById(archive, op.id), op.id);
      object.text = op.text;
      changed.add(op.id);
      return;
    }
    case "set_edge_style": {
      const object = requireLineEdgeRecord(archive, op.id);
      if (op.text !== undefined) {
        object.text = op.text;
      }
      if (op.lineType !== undefined) {
        object.lineType = op.lineType;
      }
      if (op.color !== undefined) {
        object.color = createColor(op.color);
      }
      changed.add(op.id);
      return;
    }
    case "move_objects": {
      for (const id of op.ids) {
        const object = requireRectangularObjectRecord(archive, id);
        const rect = getStageObjectRectangle(object);
        setStageObjectRectangle(object, rect.x + op.delta.x, rect.y + op.delta.y, rect.width, rect.height);
        changed.add(id);
      }
      return;
    }
    case "layout_grid": {
      const ids =
        op.ids ??
        archive.stage
          .filter(isRectangularStageObject)
          .map(getUuid)
          .filter((id): id is string => Boolean(id));
      const columns = Math.max(1, Math.floor(op.columns ?? Math.ceil(Math.sqrt(ids.length || 1))));
      const origin = op.origin ?? { x: 0, y: 0 };
      const gap = op.gap ?? { width: 80, height: 80 };
      ids.forEach((id, index) => {
        const object = requireRectangularObjectRecord(archive, id);
        const rect = getStageObjectRectangle(object);
        const cell = op.cell ?? { width: rect.width, height: rect.height };
        const column = index % columns;
        const row = Math.floor(index / columns);
        setStageObjectRectangle(
          object,
          origin.x + column * (cell.width + gap.width),
          origin.y + row * (cell.height + gap.height),
          rect.width,
          rect.height,
        );
        changed.add(id);
      });
      return;
    }
    case "delete_object": {
      deleteObject(archive, op.id, changed);
      return;
    }
    case "set_color": {
      const object = requireRecord(findStageObjectById(archive, op.id), op.id);
      object.color = createColor(op.color);
      changed.add(op.id);
      return;
    }
    case "import_markdown": {
      const imported = importMarkdown(op.markdown, { origin: op.origin, prgVersion: archive.metadata.version });
      appendArchive(archive, imported, changed, warnings);
      return;
    }
    case "import_mermaid": {
      const imported = importMermaid(op.mermaid, { origin: op.origin, prgVersion: archive.metadata.version });
      appendArchive(archive, imported, changed, warnings);
      return;
    }
  }
}

function createEmptyPgJson(prgVersion = "2.4.0"): PgJsonDocument {
  return {
    schemaVersion: PGJSON_SCHEMA_VERSION,
    prgVersion,
    nodes: [],
    sections: [],
    edges: [],
    tags: [],
    attachments: [],
    unsupportedObjects: [],
    warnings: [],
  };
}

function createTextNode(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { color?: PgJsonColor; detailsMarkdown?: string } = {},
): RecordValue {
  return {
    _: "TextNode",
    uuid: id,
    text,
    details: markdownToDetails(options.detailsMarkdown ?? ""),
    collisionBox: createRectangleCollisionBox(x, y, width, height),
    color: createColor(options.color),
    fontScaleLevel: 0,
    sizeAdjust: "manual",
    fontFamily: "",
    fontWeight: "",
  };
}

function createImageNode(
  id: string,
  attachmentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { detailsMarkdown?: string; scale?: number; isBackground?: boolean } = {},
): RecordValue {
  return {
    _: "ImageNode",
    uuid: id,
    details: markdownToDetails(options.detailsMarkdown ?? ""),
    collisionBox: createRectangleCollisionBox(x, y, width, height),
    attachmentId,
    scale: options.scale ?? 1,
    isBackground: options.isBackground ?? false,
  };
}

function createSvgNode(
  id: string,
  attachmentId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { color?: PgJsonColor; detailsMarkdown?: string; scale?: number } = {},
): RecordValue {
  return {
    _: "SvgNode",
    uuid: id,
    details: markdownToDetails(options.detailsMarkdown ?? ""),
    collisionBox: createRectangleCollisionBox(x, y, width, height),
    color: createColor(options.color),
    attachmentId,
    scale: options.scale ?? 1,
  };
}

function createSection(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    children?: unknown[];
    color?: PgJsonColor;
    detailsMarkdown?: string;
    collapsed?: boolean;
    locked?: boolean;
  } = {},
): RecordValue {
  return {
    _: "Section",
    uuid: id,
    _collisionBoxNormal: createLineCollisionBox(x, y, width, height),
    color: createColor(options.color),
    text,
    children: options.children ?? [],
    isCollapsed: options.collapsed ?? false,
    locked: options.locked ?? false,
    details: markdownToDetails(options.detailsMarkdown ?? ""),
  };
}

function createLineEdge(
  id: string,
  sourceRef: unknown,
  targetRef: unknown,
  options: { text?: string; lineType?: string; color?: PgJsonColor } = {},
): RecordValue {
  return {
    _: "LineEdge",
    uuid: id,
    associationList: [sourceRef, targetRef],
    text: options.text ?? "",
    color: createColor(options.color),
    sourceRectangleRate: createVector(0.5, 0.5),
    targetRectangleRate: createVector(0.5, 0.5),
    lineType: options.lineType ?? "solid",
  };
}

function createRectangleCollisionBox(x: number, y: number, width: number, height: number): RecordValue {
  return {
    _: "CollisionBox",
    shapes: [
      {
        _: "Rectangle",
        location: createVector(x, y),
        size: createVector(width, height),
      },
    ],
  };
}

function createLineCollisionBox(x: number, y: number, width: number, height: number): RecordValue {
  return {
    _: "CollisionBox",
    shapes: [
      createLine(x, y, x + width, y),
      createLine(x + width, y, x + width, y + height),
      createLine(x + width, y + height, x, y + height),
      createLine(x, y + height, x, y),
    ],
  };
}

function createLine(startX: number, startY: number, endX: number, endY: number): RecordValue {
  return {
    _: "Line",
    start: createVector(startX, startY),
    end: createVector(endX, endY),
  };
}

function createVector(x: number, y: number): RecordValue {
  return { _: "Vector", x, y };
}

function createColor(color: PgJsonColor = transparentColor()): RecordValue {
  return { _: "Color", r: color.r, g: color.g, b: color.b, a: color.a };
}

function transparentColor(): PgJsonColor {
  return { r: 0, g: 0, b: 0, a: 0 };
}

function normalizeColor(value: unknown): PgJsonColor {
  if (!isRecord(value)) {
    return transparentColor();
  }
  return {
    r: getNumber(value.r, 0),
    g: getNumber(value.g, 0),
    b: getNumber(value.b, 0),
    a: getNumber(value.a, 0),
  };
}

function getStageObjectRectangle(item: RecordValue): PgJsonPoint & PgJsonSize {
  const collisionBox = getSerializedType(item) === "Section" ? item._collisionBoxNormal : item.collisionBox;
  const shapes = isRecord(collisionBox) && Array.isArray(collisionBox.shapes) ? collisionBox.shapes : [];
  const rectangles = shapes.map(shapeToRectangle).filter((rect): rect is PgJsonPoint & PgJsonSize => Boolean(rect));
  if (rectangles.length === 0) {
    return { x: 0, y: 0, width: TEXT_NODE_WIDTH, height: TEXT_NODE_HEIGHT };
  }
  return boundingBox(rectangles);
}

function setStageObjectRectangle(item: RecordValue, x: number, y: number, width: number, height: number): void {
  if (getSerializedType(item) === "Section") {
    item._collisionBoxNormal = createLineCollisionBox(x, y, width, height);
  } else {
    item.collisionBox = createRectangleCollisionBox(x, y, width, height);
  }
}

function shapeToRectangle(shape: unknown): (PgJsonPoint & PgJsonSize) | undefined {
  if (!isRecord(shape)) {
    return undefined;
  }
  const type = getSerializedType(shape);
  if (type === "Rectangle" && isRecord(shape.location) && isRecord(shape.size)) {
    return {
      x: getNumber(shape.location.x, 0),
      y: getNumber(shape.location.y, 0),
      width: getNumber(shape.size.x, 0),
      height: getNumber(shape.size.y, 0),
    };
  }
  if (type === "Line" && isRecord(shape.start) && isRecord(shape.end)) {
    const startX = getNumber(shape.start.x, 0);
    const startY = getNumber(shape.start.y, 0);
    const endX = getNumber(shape.end.x, 0);
    const endY = getNumber(shape.end.y, 0);
    return {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    };
  }
  return undefined;
}

function boundingBox(rectangles: Array<PgJsonPoint & PgJsonSize>): PgJsonPoint & PgJsonSize {
  const left = Math.min(...rectangles.map((rect) => rect.x));
  const top = Math.min(...rectangles.map((rect) => rect.y));
  const right = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function detailsToMarkdown(details: unknown): string {
  if (!Array.isArray(details)) {
    return "";
  }
  return details
    .map((block) => collectText(block).trim())
    .filter(Boolean)
    .join("\n\n");
}

function collectText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return "";
  }
  const selfText = typeof value.text === "string" ? value.text : "";
  const childText = Array.isArray(value.children) ? value.children.map(collectText).join("") : "";
  return selfText + childText;
}

function markdownToDetails(markdown: string): RecordValue[] {
  const blocks = markdown
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.map((block) => ({ type: "p", children: [{ text: block }] }));
}

function parseMarkdown(markdown: string): MarkdownNode[] {
  const roots: MarkdownNode[] = [];
  const stack: Array<{ node: MarkdownNode; level: number }> = [];

  for (const line of markdown.replace(/\r/g, "").split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const node: MarkdownNode = { title: heading[2].trim(), content: "", children: [] };
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const parent = stack.at(-1);
      if (parent) {
        parent.node.children.push(node);
      } else {
        roots.push(node);
      }
      stack.push({ node, level });
      continue;
    }

    if (line.trim() && stack.length > 0) {
      const node = stack[stack.length - 1].node;
      node.content = node.content ? `${node.content}\n${line}` : line;
    }
  }

  return roots;
}

function parseMermaidEdge(
  line: string,
): { source: string; target: string; label?: string; lineType: string } | undefined {
  const patterns = [
    { regex: /^(.+?)\s*--\s*["']?(.+?)["']?\s*-->\s*(.+)$/, lineType: "solid" },
    { regex: /^(.+?)\s*-->\s*(.+)$/, lineType: "solid" },
    { regex: /^(.+?)\s*-\.\s*["']?(.+?)["']?\s*\.->\s*(.+)$/, lineType: "dashed" },
    { regex: /^(.+?)\s*-\.->\s*(.+)$/, lineType: "dashed" },
    { regex: /^(.+?)\s*==\s*["']?(.+?)["']?\s*==>\s*(.+)$/, lineType: "double" },
    { regex: /^(.+?)\s*==>\s*(.+)$/, lineType: "double" },
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern.regex);
    if (!match) {
      continue;
    }
    if (match.length === 4) {
      return {
        source: match[1].trim(),
        label: unescapeMermaidText(match[2].trim()),
        target: match[3].trim(),
        lineType: pattern.lineType,
      };
    }
    return {
      source: match[1].trim(),
      target: match[2].trim(),
      lineType: pattern.lineType,
    };
  }
  return undefined;
}

function parseMermaidNodeToken(token: string): MermaidNodeToken {
  const trimmed = token.trim().replace(/;$/, "");
  const bracketMatch = trimmed.match(/^([^[]+)\[(.*)\]$/);
  if (bracketMatch) {
    return {
      id: unescapeMermaidText(bracketMatch[1].trim()),
      label: stripQuotes(unescapeMermaidText(bracketMatch[2].trim())),
    };
  }
  const roundMatch = trimmed.match(/^([^(]+)\((.*)\)$/);
  if (roundMatch) {
    return {
      id: unescapeMermaidText(roundMatch[1].trim()),
      label: stripQuotes(unescapeMermaidText(roundMatch[2].trim())),
    };
  }
  const rhombusMatch = trimmed.match(/^([^{}]+)\{(.*)\}$/);
  if (rhombusMatch) {
    return {
      id: unescapeMermaidText(rhombusMatch[1].trim()),
      label: stripQuotes(unescapeMermaidText(rhombusMatch[2].trim())),
    };
  }
  return { id: stripQuotes(unescapeMermaidText(trimmed)) };
}

function escapeMermaidText(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}

function unescapeMermaidText(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/<br\s*\/?>/gi, "\n");
}

function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `node-${createId()}`;
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index++;
  }
  used.add(candidate);
  return candidate;
}

function getSerializedType(value: unknown): string {
  return isRecord(value) && typeof value._ === "string" ? value._ : "unknown";
}

function getUuid(value: unknown): string | undefined {
  return isRecord(value) && typeof value.uuid === "string" ? value.uuid : undefined;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveObjectList(value: unknown, stage: unknown[]): unknown[] {
  return Array.isArray(value) ? value.map((item) => resolveStageReference(item, stage)).filter(Boolean) : [];
}

function resolveStageReference(value: unknown, stage: unknown[]): unknown | undefined {
  if (isRecord(value) && typeof value.$ === "string") {
    const match = value.$.match(/^\/(\d+)$/);
    if (!match) {
      return undefined;
    }
    return stage[Number(match[1])];
  }
  return value;
}

function refFromId(idToIndex: Map<string, number>, id: string): RecordValue {
  const index = idToIndex.get(id);
  if (index === undefined) {
    throw new Error(`Cannot find object referenced by id: ${id}`);
  }
  return { $: `/${index}` };
}

function refForObjectId(archive: PrgArchive, id: string): RecordValue {
  const index = archive.stage.findIndex((item) => getUuid(item) === id);
  if (index === -1) {
    throw new Error(`Cannot find object referenced by id: ${id}`);
  }
  return { $: `/${index}` };
}

function refForSectionChildId(archive: PrgArchive, sectionId: string, childId: string): RecordValue {
  if (sectionId === childId) {
    throw new Error(`Section cannot contain itself: ${sectionId}`);
  }
  const child = requireRecord(findStageObjectById(archive, childId), childId);
  if (getSerializedType(child) === "LineEdge") {
    throw new Error(`Section children must be entities, not edges: ${childId}`);
  }
  return refForObjectId(archive, childId);
}

function setSectionChildren(archive: PrgArchive, sectionId: string, childIds: string[]): void {
  const section = requireSectionRecord(archive, sectionId);
  section.children = uniqueStrings(childIds).map((childId) => refForSectionChildId(archive, sectionId, childId));
}

function addObjectIdsToSection(archive: PrgArchive, sectionId: string, childIds: string[], changed: Set<string>): void {
  const section = requireSectionRecord(archive, sectionId);
  const existing = resolveObjectList(section.children, archive.stage)
    .map(getUuid)
    .filter((id): id is string => Boolean(id));
  setSectionChildren(archive, sectionId, [...existing, ...childIds]);
  changed.add(sectionId);
  for (const childId of childIds) {
    changed.add(childId);
  }
}

function removeObjectIdsFromSection(
  archive: PrgArchive,
  sectionId: string,
  childIds: string[],
  changed: Set<string>,
): void {
  const section = requireSectionRecord(archive, sectionId);
  const removed = new Set(childIds);
  const next = resolveObjectList(section.children, archive.stage)
    .map(getUuid)
    .filter((id): id is string => typeof id === "string" && !removed.has(id));
  setSectionChildren(archive, sectionId, next);
  changed.add(sectionId);
  for (const childId of childIds) {
    changed.add(childId);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function findStageObjectById(archive: PrgArchive, id: string): unknown {
  return archive.stage.find((item) => getUuid(item) === id);
}

function requireRecord(value: unknown, id: string): RecordValue {
  if (!isRecord(value)) {
    throw new Error(`Cannot find stage object: ${id}`);
  }
  return value;
}

function requireSectionRecord(archive: PrgArchive, id: string): RecordValue {
  const object = requireRecord(findStageObjectById(archive, id), id);
  if (getSerializedType(object) !== "Section") {
    throw new Error(`Stage object is not a section: ${id}`);
  }
  return object;
}

function requireLineEdgeRecord(archive: PrgArchive, id: string): RecordValue {
  const object = requireRecord(findStageObjectById(archive, id), id);
  if (getSerializedType(object) !== "LineEdge") {
    throw new Error(`Stage object is not a line edge: ${id}`);
  }
  return object;
}

function requireRectangularObjectRecord(archive: PrgArchive, id: string): RecordValue {
  const object = requireRecord(findStageObjectById(archive, id), id);
  if (!isRectangularStageObject(object)) {
    throw new Error(`Stage object does not have a rectangular layout: ${id}`);
  }
  return object;
}

function isRectangularStageObject(value: unknown): value is RecordValue {
  if (!isRecord(value)) {
    return false;
  }
  const type = getSerializedType(value);
  return type !== "LineEdge" && (type === "Section" || isRecord(value.collisionBox));
}

function ensureIdUnused(archive: PrgArchive, id: string): void {
  if (archive.stage.some((item) => getUuid(item) === id)) {
    throw new Error(`Stage object id already exists: ${id}`);
  }
}

function nextFreePosition(archive: PrgArchive): PgJsonPoint {
  const rectangles = archive.stage.filter(isRectangularStageObject).map(getStageObjectRectangle);
  if (rectangles.length === 0) {
    return { x: 0, y: 0 };
  }
  const bounds = boundingBox(rectangles);
  return { x: bounds.x + bounds.width + 120, y: bounds.y };
}

function addAttachmentFromOperation(
  archive: PrgArchive,
  nodeId: string,
  operation: { attachmentId?: string; dataBase64: string; extension?: string; path?: string },
): string {
  const usedIds = new Set(archive.attachments.keys());
  const requestedId = operation.attachmentId;
  const attachmentId = requestedId ?? uniqueId(`${nodeId}-attachment`, usedIds);
  if (requestedId && archive.attachments.has(requestedId)) {
    throw new Error(`Attachment id already exists: ${requestedId}`);
  }

  const extension = normalizeExtension(operation.extension ?? extensionFromPath(operation.path) ?? "bin");
  archive.attachments.set(attachmentId, {
    id: attachmentId,
    extension,
    path: operation.path ?? `attachments/${attachmentId}.${extension}`,
    data: decodeBase64(operation.dataBase64),
  });
  return attachmentId;
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./, "") || "bin";
}

function extensionFromPath(path: string | undefined): string | undefined {
  const match = path?.match(/\.([A-Za-z0-9]+)$/);
  return match?.[1];
}

function deleteObject(archive: PrgArchive, id: string, changed: Set<string>): void {
  const index = archive.stage.findIndex((item) => getUuid(item) === id);
  if (index === -1) {
    throw new Error(`Cannot find stage object: ${id}`);
  }

  const originalStage = [...archive.stage];
  changed.add(id);

  const shouldRemoveEdge = (edge: unknown): boolean => {
    if (!isRecord(edge) || getSerializedType(edge) !== "LineEdge") {
      return false;
    }
    return resolveObjectList(edge.associationList, originalStage).some((target) => getUuid(target) === id);
  };

  archive.stage = originalStage.filter((item, itemIndex) => {
    if (itemIndex === index) {
      return false;
    }
    if (shouldRemoveEdge(item)) {
      const edgeId = getUuid(item);
      if (edgeId) {
        changed.add(edgeId);
      }
      return false;
    }
    return true;
  });

  rewriteReferencesAfterDeletion(archive, originalStage);
}

function rewriteReferencesAfterDeletion(archive: PrgArchive, originalStage: unknown[]): void {
  const idToIndex = new Map<string, number>();
  archive.stage.forEach((item, index) => {
    const id = getUuid(item);
    if (id) {
      idToIndex.set(id, index);
    }
  });

  for (const item of archive.stage) {
    if (!isRecord(item)) {
      continue;
    }
    if (getSerializedType(item) === "LineEdge") {
      const refs = resolveObjectList(item.associationList, originalStage)
        .map((target) => getUuid(target))
        .filter((targetId): targetId is string => typeof targetId === "string" && idToIndex.has(targetId))
        .map((targetId) => refFromId(idToIndex, targetId));
      item.associationList = refs;
    }
    if (getSerializedType(item) === "Section") {
      const refs = resolveObjectList(item.children, originalStage)
        .map((target) => getUuid(target))
        .filter((targetId): targetId is string => typeof targetId === "string" && idToIndex.has(targetId))
        .map((targetId) => refFromId(idToIndex, targetId));
      item.children = refs;
    }
  }
}

function appendArchive(target: PrgArchive, imported: PrgArchive, changed: Set<string>, warnings: string[]): void {
  const oldIndexToNewIndex = new Map<number, number>();
  const originalLength = target.stage.length;
  const usedIds = new Set(target.stage.map(getUuid).filter((id): id is string => Boolean(id)));

  for (let oldIndex = 0; oldIndex < imported.stage.length; oldIndex++) {
    const item = imported.stage[oldIndex];
    const cloned = cloneValue(item);
    oldIndexToNewIndex.set(oldIndex, target.stage.length);
    if (isRecord(cloned)) {
      const oldId = getUuid(cloned);
      if (oldId) {
        const newId = uniqueId(oldId, usedIds);
        if (newId !== oldId) {
          warnings.push(`Renamed imported object ${oldId} to ${newId} to avoid id collision.`);
          cloned.uuid = newId;
        }
        changed.add(newId);
      }
    }
    target.stage.push(cloned);
  }

  for (let index = originalLength; index < target.stage.length; index++) {
    const item = target.stage[index];
    if (!isRecord(item)) {
      continue;
    }
    if (getSerializedType(item) === "LineEdge" && Array.isArray(item.associationList)) {
      item.associationList = item.associationList.map((ref) => rewriteImportedRef(ref, oldIndexToNewIndex));
    }
    if (getSerializedType(item) === "Section" && Array.isArray(item.children)) {
      item.children = item.children.map((ref) => rewriteImportedRef(ref, oldIndexToNewIndex));
    }
  }
}

function rewriteImportedRef(ref: unknown, oldIndexToNewIndex: Map<number, number>): unknown {
  if (isRecord(ref) && typeof ref.$ === "string") {
    const match = ref.$.match(/^\/(\d+)$/);
    if (!match) {
      return ref;
    }
    const oldIndex = Number(match[1]);
    const newIndex = oldIndexToNewIndex.get(oldIndex);
    if (newIndex === undefined) {
      return ref;
    }
    return { $: `/${newIndex}` };
  }
  return ref;
}

function normalizeMetadata(metadata: PrgMetadata | undefined, version: string): PrgMetadata {
  return {
    ...(metadata ? cloneValue(metadata) : {}),
    version,
  };
}

function cloneReferences(references: PrgReferences | undefined): PrgReferences {
  return references ? cloneValue(references) : { sections: {}, files: [] };
}

function cloneArchive(archive: PrgArchive): PrgArchive {
  return {
    stage: cloneValue(archive.stage),
    tags: [...archive.tags],
    references: cloneReferences(archive.references),
    metadata: cloneValue(archive.metadata),
    readme: archive.readme,
    attachments: cloneAttachmentMap(archive.attachments),
    thumbnail: archive.thumbnail ? new Uint8Array(archive.thumbnail) : undefined,
    extraEntries: cloneUint8Map(archive.extraEntries),
  };
}

function cloneAttachmentMap(source: Map<string, PrgAttachment> | undefined): Map<string, PrgAttachment> {
  const result = new Map<string, PrgAttachment>();
  for (const [id, attachment] of source?.entries() ?? []) {
    result.set(id, {
      ...attachment,
      data: new Uint8Array(attachment.data),
    });
  }
  return result;
}

function cloneUint8Map(source: Map<string, Uint8Array> | undefined): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const [path, data] of source?.entries() ?? []) {
    result.set(path, new Uint8Array(data));
  }
  return result;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value) as T;
}

function encodeBase64(data: Uint8Array): string {
  let output = "";
  for (let index = 0; index < data.length; index += 3) {
    const first = data[index]!;
    const hasSecond = index + 1 < data.length;
    const hasThird = index + 2 < data.length;
    const second = hasSecond ? data[index + 1]! : 0;
    const third = hasThird ? data[index + 2]! : 0;

    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0b11) << 4) | (second >> 4)];
    output += hasSecond ? BASE64_ALPHABET[((second & 0b1111) << 2) | (third >> 6)] : "=";
    output += hasThird ? BASE64_ALPHABET[third & 0b111111] : "=";
  }
  return output;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, "");
  if (normalized.length % 4 !== 0) {
    throw new Error("Invalid base64 attachment data.");
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const first = requireBase64Value(normalized[index]);
    const second = requireBase64Value(normalized[index + 1]);
    const third = normalized[index + 2] === "=" ? undefined : requireBase64Value(normalized[index + 2]);
    const fourth = normalized[index + 3] === "=" ? undefined : requireBase64Value(normalized[index + 3]);

    bytes.push((first << 2) | (second >> 4));
    if (third !== undefined) {
      bytes.push(((second & 0b1111) << 4) | (third >> 2));
    }
    if (third !== undefined && fourth !== undefined) {
      bytes.push(((third & 0b11) << 6) | fourth);
    }
  }

  return new Uint8Array(bytes);
}

function requireBase64Value(char: string | undefined): number {
  const value = char ? BASE64_VALUES.get(char) : undefined;
  if (value === undefined) {
    throw new Error("Invalid base64 attachment data.");
  }
  return value;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
