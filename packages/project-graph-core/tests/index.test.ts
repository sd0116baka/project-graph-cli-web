import { describe, expect, it } from "vitest";
import {
  applyOperationsToArchive,
  archiveToPgJson,
  exportMarkdown,
  exportMermaid,
  importMarkdown,
  importMermaid,
  pgJsonToArchive,
} from "../src/index";
import type { PrgArchive } from "@graphif/prg-codec";

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
});
