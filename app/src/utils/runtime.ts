export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && !isTauriRuntime();
}
