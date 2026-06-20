import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["app/src", "packages"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const strict = process.argv.includes("--strict");

const allowedTauriImports = importPolicy([
  [
    "app/src/App.tsx",
    ["@tauri-apps/api/app", "@tauri-apps/api/window", "@tauri-apps/plugin-os", "@tauri-apps/plugin-window-state"],
    "Desktop window lifecycle and OS metadata.",
  ],
  ["app/src/DropWindowCover.tsx", ["@tauri-apps/api/window"], "Desktop drag-and-drop window wiring."],
  ["app/src/cli.tsx", ["@tauri-apps/plugin-cli"], "Tauri CLI entrypoint."],
  [
    "app/src/main.tsx",
    [
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-cli",
      "@tauri-apps/plugin-deep-link",
      "@tauri-apps/plugin-fs",
    ],
    "Desktop bootstrap, deep links, and app events.",
  ],
  [
    "app/src/core/extension/Extension.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Desktop extension host file installation.",
  ],
  [
    "app/src/core/extension/ExtensionManager.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Desktop extension discovery.",
  ],
  [
    "app/src/core/extension/api/host.tsx",
    ["@tauri-apps/api/core", "@tauri-apps/plugin-http"],
    "Desktop extension host APIs.",
  ],
  [
    "app/src/core/fileSystemProvider/FileSystemProviderDraft.tsx",
    ["@tauri-apps/plugin-dialog", "@tauri-apps/plugin-fs"],
    "Local project filesystem provider.",
  ],
  [
    "app/src/core/fileSystemProvider/FileSystemProviderFile.tsx",
    ["@tauri-apps/plugin-fs"],
    "Local project filesystem provider.",
  ],
  [
    "app/src/core/fileSystemProvider/FileSystemProviderServer.tsx",
    ["@tauri-apps/plugin-fs"],
    "Provider type compatibility.",
  ],
  ["app/src/core/interfaces/Service.tsx", ["@tauri-apps/plugin-fs"], "Provider type compatibility."],
  [
    "app/src/core/runtime/ProjectRuntimeActions.ts",
    ["@tauri-apps/plugin-dialog", "@tauri-apps/plugin-fs", "@tauri-apps/plugin-shell"],
    "Runtime adapter implementation.",
  ],
  [
    "app/src/core/service/controlService/shortcutKeysEngine/GlobalShortcutManager.tsx",
    ["@tauri-apps/api/window", "@tauri-apps/plugin-global-shortcut"],
    "Desktop global shortcuts.",
  ],
  [
    "app/src/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister.tsx",
    ["@tauri-apps/api/dpi", "@tauri-apps/api/image", "@tauri-apps/api/window", "@tauri-apps/plugin-clipboard-manager"],
    "Desktop shortcut window integration.",
  ],
  [
    "app/src/core/service/dataFileService/ServerProjectManager.tsx",
    ["@tauri-apps/api/core"],
    "Desktop embedded backend control bridge.",
  ],
  [
    "app/src/core/service/dataFileService/StartFilesManager.tsx",
    ["@tauri-apps/plugin-fs", "@tauri-apps/plugin-store"],
    "Desktop startup file handoff.",
  ],
  [
    "app/src/core/service/liveCommandService.ts",
    ["@tauri-apps/api/core", "@tauri-apps/api/event"],
    "Desktop live bridge compatibility.",
  ],
  ["app/src/utils/externalOpen.tsx", ["@tauri-apps/plugin-shell"], "Desktop shell helper."],
  [
    "app/src/utils/otherApi.tsx",
    ["@tauri-apps/api/app", "@tauri-apps/api/core"],
    "Desktop app metadata and invoke helper.",
  ],
  ["app/src/utils/path.tsx", ["@tauri-apps/api/path"], "Desktop path separator helper."],
  ["app/src/utils/platform.tsx", ["@tauri-apps/plugin-os"], "Desktop platform helper."],
  ["app/src/utils/readPrgThumbnail.ts", ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"], "Desktop thumbnail cache."],
  ["app/src/utils/store.tsx", ["@tauri-apps/plugin-store"], "Desktop persistent settings store."],
  ["app/src/utils/updater.tsx", ["@tauri-apps/plugin-updater"], "Desktop updater."],
  [
    "packages/extprg-types/index.d.ts",
    ["@tauri-apps/plugin-fs", "@tauri-apps/plugin-http", "@tauri-apps/plugin-store"],
    "Extension host type declarations.",
  ],
]);

const trackedMigrationDebt = importPolicy([
  [
    "app/src/components/ui/dialog.tsx",
    ["@tauri-apps/plugin-clipboard-manager"],
    "Clipboard action should route through a browser/Desktop clipboard adapter.",
  ],
  [
    "app/src/components/ui/file-chooser.tsx",
    ["@tauri-apps/plugin-dialog"],
    "Reusable chooser should be split into browser and Desktop implementations.",
  ],
  [
    "app/src/components/welcome-page.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs", "@tauri-apps/plugin-shell"],
    "Welcome export/open actions are still Desktop-only.",
  ],
  [
    "app/src/core/service/AssetsRepository.tsx",
    ["@tauri-apps/plugin-http"],
    "HTTP fetch should use transport adapter or native fetch in Web.",
  ],
  [
    "app/src/core/service/AuthClient.tsx",
    ["@tauri-apps/plugin-http"],
    "HTTP fetch should use transport adapter or native fetch in Web.",
  ],
  [
    "app/src/core/service/GlobalMenu.tsx",
    [
      "@tauri-apps/api/path",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-shell",
    ],
    "Remaining file-menu local filesystem actions need ProjectRuntimeActions coverage.",
  ],
  [
    "app/src/core/service/Telemetry.tsx",
    ["@tauri-apps/plugin-http"],
    "HTTP fetch should use transport adapter or native fetch in Web.",
  ],
  [
    "app/src/core/service/Themes.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Theme import/export should route through runtime storage actions.",
  ],
  [
    "app/src/core/service/Tourials.tsx",
    ["@tauri-apps/plugin-store"],
    "Tutorial state should use runtime storage abstraction.",
  ],
  [
    "app/src/core/service/UserState.tsx",
    ["@tauri-apps/plugin-store"],
    "User state should use runtime storage abstraction.",
  ],
  [
    "app/src/core/service/controlService/controller/concrete/ControllerNodeEdit.tsx",
    ["@tauri-apps/plugin-shell"],
    "Open reference command should route through runtime actions.",
  ],
  [
    "app/src/core/service/controlService/controller/concrete/ControllerPenStrokeDrawing.tsx",
    ["@tauri-apps/api/core", "@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Pen export/temp image action should route through runtime actions.",
  ],
  [
    "app/src/core/service/dataFileService/AutoSaveBackupService.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Backup storage should route through runtime actions.",
  ],
  [
    "app/src/core/service/dataFileService/DeepLinkHandler.ts",
    ["@tauri-apps/plugin-fs"],
    "Deep link file checks should be Desktop-only gated.",
  ],
  [
    "app/src/core/service/dataFileService/RecentFileManager.tsx",
    ["@tauri-apps/plugin-fs", "@tauri-apps/plugin-store"],
    "Recent file storage should be runtime-scoped.",
  ],
  [
    "app/src/core/service/dataFileService/ReferenceFileScanner.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Local reference scanning should move behind runtime actions.",
  ],
  [
    "app/src/core/service/dataGenerateService/TextFileImporter.tsx",
    ["@tauri-apps/plugin-dialog", "@tauri-apps/plugin-fs"],
    "Text import dialog should be owned by ProjectRuntimeActions.",
  ],
  [
    "app/src/core/service/dataGenerateService/generateFromFolderEngine/GenerateFromFolderEngine.tsx",
    ["@tauri-apps/api/core"],
    "Tauri folder scanner should be owned by ProjectRuntimeActions.",
  ],
  [
    "app/src/core/service/dataGenerateService/stageExportEngine/StageExportSvg.tsx",
    ["@tauri-apps/plugin-fs"],
    "Legacy save-to-path helpers should move behind ProjectRuntimeActions.",
  ],
  [
    "app/src/core/service/dataManageService/aiEngine/AIEngine.tsx",
    ["@tauri-apps/plugin-http"],
    "HTTP fetch should use transport adapter or native fetch in Web.",
  ],
  [
    "app/src/core/service/dataManageService/copyEngine/copyEngine.tsx",
    ["@tauri-apps/api/image", "@tauri-apps/plugin-clipboard-manager"],
    "Clipboard action should route through a browser/Desktop clipboard adapter.",
  ],
  [
    "app/src/core/service/dataManageService/copyEngine/copyEngineImage.tsx",
    ["@tauri-apps/plugin-clipboard-manager"],
    "Clipboard action should route through a browser/Desktop clipboard adapter.",
  ],
  [
    "app/src/core/service/dataManageService/dragFileIntoStageEngine/dragFileIntoStageEngine.tsx",
    ["@tauri-apps/plugin-fs"],
    "Dragged file reads should route through browser File API or Desktop file adapter.",
  ],
  [
    "app/src/core/service/feedbackService/ColorManager.tsx",
    ["@tauri-apps/plugin-store"],
    "Color state should use runtime storage abstraction.",
  ],
  [
    "app/src/core/service/feedbackService/SoundService.tsx",
    ["@tauri-apps/plugin-fs"],
    "Sound file reads should route through runtime asset actions.",
  ],
  [
    "app/src/core/stage/ProjectUpgrader.tsx",
    ["@tauri-apps/plugin-fs"],
    "Legacy project upgrade file reads should route through runtime actions.",
  ],
  [
    "app/src/sub/AttachmentsWindow.tsx",
    ["@tauri-apps/plugin-dialog", "@tauri-apps/plugin-fs"],
    "Attachment import/export should route through runtime file exchange actions.",
  ],
  [
    "app/src/sub/RecentFilesWindow.tsx",
    ["@tauri-apps/api/core", "@tauri-apps/plugin-dialog"],
    "Recent files UI should be Desktop-only gated or backend-aware.",
  ],
  [
    "app/src/sub/SettingsWindow/about.tsx",
    ["@tauri-apps/plugin-shell"],
    "External links should route through browser/Desktop shell adapter.",
  ],
  [
    "app/src/sub/SettingsWindow/account.tsx",
    ["@tauri-apps/plugin-shell"],
    "External links should route through browser/Desktop shell adapter.",
  ],
  [
    "app/src/sub/SettingsWindow/credits.tsx",
    ["@tauri-apps/plugin-http", "@tauri-apps/plugin-shell"],
    "HTTP fetch and links should route through runtime adapters.",
  ],
  [
    "app/src/sub/SettingsWindow/customization/sounds.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs", "@tauri-apps/plugin-shell"],
    "Sound customization file exchange should route through runtime actions.",
  ],
  [
    "app/src/sub/SettingsWindow/extensions.tsx",
    ["@tauri-apps/plugin-shell"],
    "External links should route through browser/Desktop shell adapter.",
  ],
  [
    "app/src/sub/SettingsWindow/linuxRuntime.tsx",
    ["@tauri-apps/plugin-fs"],
    "Linux runtime settings are Desktop-only and need a boundary wrapper.",
  ],
  [
    "app/src/sub/SettingsWindow/local-ai.tsx",
    ["@tauri-apps/api/core"],
    "Local AI invoke action is Desktop-only and needs a boundary wrapper.",
  ],
  [
    "app/src/sub/SettingsWindow/themes/index.tsx",
    ["@tauri-apps/plugin-dialog", "@tauri-apps/plugin-fs"],
    "Theme import should route through runtime file exchange actions.",
  ],
  [
    "app/src/utils/imageExport.tsx",
    ["@tauri-apps/api/path", "@tauri-apps/plugin-fs"],
    "Legacy image export helper should move behind ProjectRuntimeActions.",
  ],
]);

const importPattern =
  /(?:from\s+["'](@tauri-apps\/[^"']+)["']|import\s*\(\s*["'](@tauri-apps\/[^"']+)["']\s*\)|import\s+["'](@tauri-apps\/[^"']+)["']|require\s*\(\s*["'](@tauri-apps\/[^"']+)["']\s*\))/g;

const findings = [];

for (const root of scanRoots) {
  await scanDirectory(path.join(repoRoot, root));
}

const allowed = [];
const debt = [];
const unknown = [];

for (const finding of findings) {
  const allowedReason = allowedTauriImports.get(policyKey(finding.file, finding.specifier));
  const debtReason = trackedMigrationDebt.get(policyKey(finding.file, finding.specifier));
  if (isTestFile(finding.file)) {
    allowed.push({ ...finding, reason: "Test mock or regression coverage." });
  } else if (allowedReason) {
    allowed.push({ ...finding, reason: allowedReason });
  } else if (debtReason) {
    debt.push({ ...finding, reason: debtReason });
  } else {
    unknown.push(finding);
  }
}

if (unknown.length > 0) {
  console.error("Found unclassified @tauri-apps imports. Move the code behind a runtime adapter or classify it:");
  printFindings(unknown);
  process.exit(1);
}

if (strict && debt.length > 0) {
  console.error("Strict Tauri import audit failed. These tracked migration-debt imports still need adapters:");
  printFindings(debt);
  process.exit(1);
}

console.log(
  `Tauri import audit passed: ${allowed.length} allowed import sites, ${debt.length} tracked migration-debt import sites, ${unknown.length} unknown.`,
);
if (debt.length > 0) {
  console.log("Run `pnpm run audit:tauri-imports -- --strict` to fail while migration debt remains.");
}

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "src-tauri") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(entryPath);
      continue;
    }

    if (!sourceExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const content = await readFile(entryPath, "utf8");
    const relativePath = normalizePath(path.relative(repoRoot, entryPath));
    for (const match of content.matchAll(importPattern)) {
      findings.push({
        file: relativePath,
        specifier: match[1] ?? match[2] ?? match[3] ?? match[4],
        line: lineNumberAt(content, match.index ?? 0),
      });
    }
  }
}

function importPolicy(entries) {
  const policy = new Map();
  for (const [file, specifiers, reason] of entries) {
    for (const specifier of specifiers) {
      policy.set(policyKey(file, specifier), reason);
    }
  }
  return policy;
}

function policyKey(file, specifier) {
  return `${file}\0${specifier}`;
}

function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}

function isTestFile(file) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function printFindings(items) {
  for (const item of items) {
    const reason = item.reason ? ` - ${item.reason}` : "";
    console.error(`- ${item.file}:${item.line} imports ${item.specifier}${reason}`);
  }
}
