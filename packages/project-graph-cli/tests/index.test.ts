import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveToPgJson } from "@graphif/project-graph-core";
import { readPrgFile } from "@graphif/prg-codec";
import { main } from "../src/index";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "project-graph-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let stdout = "";
  let stderr = "";

  console.log = (...args: unknown[]) => {
    stdout += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    stderr += `${args.map(String).join(" ")}\n`;
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    const code = await main(args);
    return { code, stdout, stderr };
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("@graphif/project-graph-cli", () => {
  it("imports markdown, patches the document, validates it, and exports mermaid", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    const input = join(dir, "input.prg");
    const patch = join(dir, "ops.json");
    const output = join(dir, "output.prg");
    const mermaid = join(dir, "output.mmd");

    await writeFile(markdown, "# Intake\n\n## Review\n", "utf8");
    await writeFile(
      patch,
      JSON.stringify([
        { op: "add_text_node", id: "ship", text: "Ship", position: { x: 520, y: 0 } },
        { op: "connect", id: "review-ship", source: "Review", target: "ship", text: "ready" },
      ]),
      "utf8",
    );

    expect((await runCli(["import", markdown, "--format", "markdown", "-o", input])).code).toBe(0);
    const patchResult = await runCli(["patch", input, patch, "-o", output, "--json"]);
    const validateResult = await runCli(["validate", output]);
    expect((await runCli(["export", output, "--format", "mermaid", "-o", mermaid])).code).toBe(0);

    expect(patchResult.code).toBe(0);
    expect(JSON.parse(patchResult.stdout)).toMatchObject({ ok: true, changed: ["ship", "review-ship"] });
    expect(validateResult).toMatchObject({ code: 0, stdout: "OK\n", stderr: "" });
    expect(await readFile(mermaid, "utf8")).toContain('id1 -- "ready" --> id2');
  });

  it("exports pgjson and imports it back into a prg document", async () => {
    const dir = await createTempDir();
    const markdown = join(dir, "outline.md");
    const sourcePrg = join(dir, "source.prg");
    const pgjson = join(dir, "graph.pg.json");
    const importedPrg = join(dir, "imported.prg");

    await writeFile(markdown, "# Root\n\nintro\n\n## Child\n", "utf8");

    expect((await runCli(["import", markdown, "-o", sourcePrg])).code).toBe(0);
    expect((await runCli(["export", sourcePrg, "--format", "pgjson", "-o", pgjson])).code).toBe(0);
    expect((await runCli(["import", pgjson, "-o", importedPrg])).code).toBe(0);

    const document = archiveToPgJson(await readPrgFile(importedPrg));
    expect(document.nodes.map((node) => node.text)).toEqual(["Root", "Child"]);
    expect(document.nodes.find((node) => node.text === "Root")?.detailsMarkdown).toBe("intro");
    expect(document.edges).toHaveLength(1);
  });
});
