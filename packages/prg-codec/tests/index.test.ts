import { describe, expect, it } from "vitest";
import {
  inspectPrgArchive,
  readPrgData,
  validatePrgArchive,
  writePrgData,
  type PrgArchive,
} from "../src/index";

function createArchive(): PrgArchive {
  const imageAttachment = {
    id: "image-1",
    extension: "png",
    path: "attachments/image-1.png",
    data: new Uint8Array([1, 2, 3]),
  };

  return {
    metadata: { version: "2.4.0" },
    tags: ["example"],
    references: { sections: {}, files: [] },
    readme: "fixture",
    stage: [
      { _: "TextNode", uuid: "node-a", text: "A" },
      { _: "TextNode", uuid: "node-b", text: "B" },
      { _: "ImageNode", uuid: "image-node", attachmentId: "image-1" },
      {
        _: "LineEdge",
        uuid: "edge-a-b",
        text: "edge",
        associationList: [{ $: "/0" }, { $: "/1" }],
      },
    ],
    attachments: new Map([[imageAttachment.id, imageAttachment]]),
    thumbnail: new Uint8Array([9, 8, 7]),
    extraEntries: new Map([["custom.bin", new Uint8Array([4, 5, 6])]]),
  };
}

describe("@graphif/prg-codec", () => {
  it("roundtrips a minimal prg archive", async () => {
    const original = createArchive();
    const data = await writePrgData(original, {
      preserveExtraEntries: true,
      preserveThumbnail: true,
    });
    const archive = await readPrgData(data);

    expect(archive.metadata.version).toBe("2.4.0");
    expect(archive.tags).toEqual(["example"]);
    expect(archive.readme).toBe("fixture");
    expect(archive.stage).toHaveLength(4);
    expect(archive.attachments.get("image-1")?.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(archive.thumbnail).toEqual(new Uint8Array([9, 8, 7]));
    expect(archive.extraEntries.get("custom.bin")).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("writes archives without optional binary collections", async () => {
    const data = await writePrgData({
      metadata: { version: "2.4.0" },
      tags: [],
      references: { sections: {}, files: [] },
      stage: [{ _: "TextNode", uuid: "node-a", text: "A" }],
    } as unknown as PrgArchive);
    const archive = await readPrgData(data);

    expect(archive.stage).toHaveLength(1);
    expect(archive.attachments.size).toBe(0);
    expect(archive.extraEntries.size).toBe(0);
  });

  it("inspects stage object counts", () => {
    const inspection = inspectPrgArchive(createArchive());

    expect(inspection.version).toBe("2.4.0");
    expect(inspection.stageObjectCount).toBe(4);
    expect(inspection.textNodeCount).toBe(2);
    expect(inspection.edgeCount).toBe(1);
    expect(inspection.objectTypes).toMatchObject({
      ImageNode: 1,
      LineEdge: 1,
      TextNode: 2,
    });
  });

  it("validates references and attachments", () => {
    const report = validatePrgArchive(createArchive());

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("reports missing association targets and attachments", () => {
    const archive = createArchive();
    archive.stage.push({
      _: "LineEdge",
      uuid: "bad-edge",
      associationList: [{ $: "/0" }, { uuid: "missing-node" }],
    });
    archive.stage.push({
      _: "ImageNode",
      uuid: "missing-image",
      attachmentId: "missing-attachment",
    });

    const report = validatePrgArchive(archive);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("missing_association_target");
    expect(report.issues.map((issue) => issue.code)).toContain("missing_attachment");
  });
});
