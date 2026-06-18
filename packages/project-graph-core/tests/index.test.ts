import { describe, expect, it } from "vitest";
import {
  PGJSON_SCHEMA_VERSION,
  PROJECT_GRAPH_OPS_SCHEMA,
  applyOperationsToArchive,
  archiveToPgJson,
  exportMarkdown,
  exportMermaid,
  importMarkdown,
  importMermaid,
  pgJsonToArchive,
  queryArchive,
  validateProjectGraphPatchPayload,
  type PgJsonDocument,
} from "../src/index";
import { validatePrgArchive, type PrgArchive } from "@graphif/prg-codec";

function createArchive(): PrgArchive {
  return {
    metadata: { version: "2.4.0" },
    tags: ["example"],
    references: { sections: {}, files: [] },
    stage: [
      {
        _: "TextNode",
        uuid: "node-a",
        text: "A",
        details: [{ type: "p", children: [{ text: "Details A" }] }],
        collisionBox: {
          _: "CollisionBox",
          shapes: [
            {
              _: "Rectangle",
              location: { _: "Vector", x: 0, y: 0 },
              size: { _: "Vector", x: 100, y: 80 },
            },
          ],
        },
        color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
        fontScaleLevel: 0,
        sizeAdjust: "manual",
        fontFamily: "",
        fontWeight: "",
      },
      {
        _: "TextNode",
        uuid: "node-b",
        text: "B",
        details: [],
        collisionBox: {
          _: "CollisionBox",
          shapes: [
            {
              _: "Rectangle",
              location: { _: "Vector", x: 240, y: 0 },
              size: { _: "Vector", x: 100, y: 80 },
            },
          ],
        },
        color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
        fontScaleLevel: 0,
        sizeAdjust: "manual",
        fontFamily: "",
        fontWeight: "",
      },
      {
        _: "LineEdge",
        uuid: "edge-a-b",
        associationList: [{ $: "/0" }, { $: "/1" }],
        text: "handoff",
        color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
        sourceRectangleRate: { _: "Vector", x: 0.5, y: 0.5 },
        targetRectangleRate: { _: "Vector", x: 0.5, y: 0.5 },
        lineType: "solid",
      },
    ],
    attachments: new Map(),
    extraEntries: new Map(),
  };
}

describe("@graphif/project-graph-core", () => {
  it("exports and reimports pgjson", () => {
    const pgjson = archiveToPgJson(createArchive());
    const archive = pgJsonToArchive(pgjson);

    expect(pgjson.nodes).toHaveLength(2);
    expect(pgjson.edges[0]).toMatchObject({ source: "node-a", target: "node-b" });
    expect(archive.stage).toHaveLength(3);
  });

  it("applies basic patch operations", () => {
    const result = applyOperationsToArchive(createArchive(), {
      ops: [
        { op: "rename_node", id: "node-a", text: "Alpha" },
        { op: "add_text_node", id: "node-c", text: "C", position: { x: 480, y: 0 } },
        { op: "connect", id: "edge-b-c", source: "node-b", target: "node-c", text: "next" },
      ],
    });
    const pgjson = archiveToPgJson(result.archive);

    expect(pgjson.nodes.find((node) => node.id === "node-a")?.text).toBe("Alpha");
    expect(pgjson.edges.find((edge) => edge.id === "edge-b-c")).toMatchObject({
      source: "node-b",
      target: "node-c",
      text: "next",
    });
  });

  it("applies section, edge style, and bulk layout operations", () => {
    const result = applyOperationsToArchive(createArchive(), {
      ops: [
        {
          op: "add_section",
          id: "section-1",
          text: "Section",
          position: { x: -40, y: -40 },
          size: { width: 520, height: 240 },
          children: ["node-a"],
        },
        { op: "add_text_node", id: "node-c", text: "C", section: "section-1" },
        { op: "set_section_text", id: "section-1", text: "Renamed section" },
        { op: "set_section_details_markdown", id: "section-1", markdown: "Section details" },
        { op: "set_section_collapsed", id: "section-1", collapsed: true },
        { op: "set_section_locked", id: "section-1", locked: true },
        { op: "add_to_section", id: "section-1", children: ["node-b"] },
        { op: "remove_from_section", id: "section-1", children: ["node-a"] },
        { op: "set_edge_style", id: "edge-a-b", text: "styled", lineType: "dashed" },
        {
          op: "layout_grid",
          ids: ["node-a", "node-b"],
          origin: { x: 10, y: 20 },
          columns: 2,
          gap: { width: 10, height: 20 },
          cell: { width: 100, height: 80 },
        },
        { op: "move_objects", ids: ["node-a", "node-b"], delta: { x: 5, y: -5 } },
      ],
    });
    const pgjson = archiveToPgJson(result.archive);

    expect(validatePrgArchive(result.archive).ok).toBe(true);
    expect(pgjson.sections[0]).toMatchObject({
      id: "section-1",
      text: "Renamed section",
      detailsMarkdown: "Section details",
      collapsed: true,
      locked: true,
      children: ["node-c", "node-b"],
    });
    expect(pgjson.edges[0]).toMatchObject({ text: "styled", lineType: "dashed" });
    expect(pgjson.nodes.find((node) => node.id === "node-a")).toMatchObject({ x: 15, y: 15 });
    expect(pgjson.nodes.find((node) => node.id === "node-b")).toMatchObject({ x: 125, y: 15 });
  });

  it("adds attachment-backed image and svg nodes", () => {
    const result = applyOperationsToArchive(createArchive(), {
      ops: [
        {
          op: "add_image_node",
          id: "image-1",
          attachmentId: "image-attachment",
          dataBase64: "AQID",
          extension: "png",
          position: { x: 100, y: 120 },
          size: { width: 320, height: 180 },
        },
        {
          op: "add_svg_node",
          id: "svg-1",
          attachmentId: "svg-attachment",
          dataBase64: "PHN2Zy8+",
          position: { x: 460, y: 120 },
          size: { width: 200, height: 100 },
        },
      ],
    });
    const pgjson = archiveToPgJson(result.archive);

    expect(validatePrgArchive(result.archive).ok).toBe(true);
    expect(pgjson.nodes.find((node) => node.id === "image-1")).toMatchObject({
      type: "image",
      attachmentId: "image-attachment",
      width: 320,
      height: 180,
    });
    expect(pgjson.nodes.find((node) => node.id === "svg-1")).toMatchObject({
      type: "svg",
      attachmentId: "svg-attachment",
    });
    expect(result.archive.attachments.get("image-attachment")?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.archive.attachments.get("svg-attachment")?.extension).toBe("svg");
  });

  it("queries exported graph objects", () => {
    const query = queryArchive(createArchive(), { kind: "node", text: "Details A" });
    const edgeQuery = queryArchive(createArchive(), { kind: "edge", text: "handoff", limit: 1 });

    expect(query).toMatchObject({ total: 1, items: [{ kind: "node", id: "node-a", type: "text" }] });
    expect(edgeQuery).toMatchObject({ total: 1, items: [{ kind: "edge", id: "edge-a-b", source: "node-a" }] });
  });

  it("validates patch payloads before applying them", () => {
    const report = validateProjectGraphPatchPayload([
      { op: "add_text_node", text: 42, unexpected: true },
      { op: "move_node", id: "node-a", position: { x: 1 } },
    ]);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["$.ops[0].text", "$.ops[0].unexpected", "$.ops[1].position.y"]),
    );
    expect(() =>
      applyOperationsToArchive(createArchive(), {
        ops: [{ op: "move_node", id: "node-a", position: { x: 1 } } as never],
      }),
    ).toThrow("Invalid Project Graph patch payload");
  });

  it("rejects edge ids for rectangular layout operations", () => {
    expect(() =>
      applyOperationsToArchive(createArchive(), {
        ops: [{ op: "move_node", id: "edge-a-b", position: { x: 10, y: 20 } }],
      }),
    ).toThrow("does not have a rectangular layout");
    expect(() =>
      applyOperationsToArchive(createArchive(), {
        ops: [{ op: "resize_node", id: "edge-a-b", size: { width: 100, height: 80 } }],
      }),
    ).toThrow("does not have a rectangular layout");
  });

  it("deletes objects without corrupting surviving references", () => {
    const archive = createArchive();
    const unusedNode = structuredClone(archive.stage[1]) as Record<string, unknown>;
    unusedNode.uuid = "node-unused";
    unusedNode.text = "Unused";
    archive.stage.splice(1, 0, unusedNode);
    (archive.stage[3] as Record<string, unknown>).associationList = [{ $: "/0" }, { $: "/2" }];

    const result = applyOperationsToArchive(archive, {
      ops: [{ op: "delete_object", id: "node-unused" }],
    });
    const pgjson = archiveToPgJson(result.archive);

    expect(validatePrgArchive(result.archive).ok).toBe(true);
    expect(result.changed).toEqual(["node-unused"]);
    expect(pgjson.nodes.map((node) => node.id)).toEqual(["node-a", "node-b"]);
    expect(pgjson.edges).toHaveLength(1);
    expect(pgjson.edges[0]).toMatchObject({ id: "edge-a-b", source: "node-a", target: "node-b" });
  });

  it("exports self-contained pgjson attachments for unsupported objects", () => {
    const archive = createArchive();
    archive.stage.push({ _: "ImageNode", uuid: "image-node", attachmentId: "image-1" });
    archive.stage.push({
      _: "LineEdge",
      uuid: "edge-a-image",
      associationList: [{ $: "/0" }, { $: "/3" }],
      text: "image",
      color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
      sourceRectangleRate: { _: "Vector", x: 0.5, y: 0.5 },
      targetRectangleRate: { _: "Vector", x: 0.5, y: 0.5 },
      lineType: "solid",
    });
    archive.attachments.set("image-1", {
      id: "image-1",
      extension: "png",
      path: "attachments/image-1.png",
      data: new Uint8Array([1, 2, 3]),
    });

    const document = archiveToPgJson(archive);
    const imported = pgJsonToArchive(document);

    expect(document.attachments[0]).toMatchObject({ id: "image-1", dataBase64: "AQID" });
    expect(imported.attachments.get("image-1")?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(validatePrgArchive(imported).ok).toBe(true);
    expect(archiveToPgJson(imported).edges.find((edge) => edge.id === "edge-a-image")).toMatchObject({
      source: "node-a",
      target: "image-node",
    });
  });

  it("imports nested sections before their children have been added", () => {
    const color = { r: 0, g: 0, b: 0, a: 0 };
    const document: PgJsonDocument = {
      schemaVersion: PGJSON_SCHEMA_VERSION,
      prgVersion: "2.4.0",
      nodes: [
        {
          id: "child-node",
          type: "text",
          text: "Child node",
          detailsMarkdown: "",
          x: 80,
          y: 100,
          width: 160,
          height: 72,
          color,
          section: "child-section",
        },
      ],
      sections: [
        {
          id: "parent-section",
          text: "Parent",
          detailsMarkdown: "",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          color,
          children: ["child-section"],
          section: null,
          collapsed: false,
          locked: false,
        },
        {
          id: "child-section",
          text: "Child",
          detailsMarkdown: "",
          x: 40,
          y: 60,
          width: 260,
          height: 180,
          color,
          children: ["child-node"],
          section: "parent-section",
          collapsed: false,
          locked: false,
        },
      ],
      edges: [],
      tags: [],
      attachments: [],
      unsupportedObjects: [],
      warnings: [],
    };

    const archive = pgJsonToArchive(document);
    const roundTrip = archiveToPgJson(archive);

    expect(validatePrgArchive(archive).ok).toBe(true);
    expect(roundTrip.sections.find((section) => section.id === "parent-section")?.children).toEqual(["child-section"]);
    expect(roundTrip.sections.find((section) => section.id === "child-section")?.children).toEqual(["child-node"]);
  });

  it("imports and exports markdown", () => {
    const archive = importMarkdown("# Root\n\nintro\n\n## Child\n");
    const markdown = exportMarkdown(archive);

    expect(archiveToPgJson(archive).nodes).toHaveLength(2);
    expect(markdown).toContain("# Root");
    expect(markdown).toContain("## Child");
  });

  it("imports and exports mermaid", () => {
    const archive = importMermaid("graph TD\nA[Alpha] --> B[Beta]\n");
    const mermaid = exportMermaid(archive);
    const pgjson = archiveToPgJson(archive);

    expect(pgjson.nodes.map((node) => node.text)).toEqual(["Alpha", "Beta"]);
    expect(pgjson.edges).toHaveLength(1);
    expect(mermaid).toContain("graph TD");
  });

  it("documents every supported patch operation in the schema", () => {
    const names = PROJECT_GRAPH_OPS_SCHEMA.$defs.operation.oneOf.map((operation) => operation.properties.op.const);

    expect([...names].sort()).toEqual(
      [
        "add_text_node",
        "add_image_node",
        "add_section",
        "add_svg_node",
        "add_to_section",
        "connect",
        "delete_object",
        "import_markdown",
        "import_mermaid",
        "layout_grid",
        "move_node",
        "move_objects",
        "remove_from_section",
        "rename_node",
        "resize_node",
        "set_color",
        "set_edge_text",
        "set_edge_style",
        "set_node_details_markdown",
        "set_section_children",
        "set_section_collapsed",
        "set_section_details_markdown",
        "set_section_locked",
        "set_section_text",
      ].sort(),
    );
  });
});
