import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerProjectManager } from "./ServerProjectManager";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("ServerProjectManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a client id when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index;
        }
        return bytes;
      },
    });

    const id = ServerProjectManager.getClientId();

    expect(id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(localStorage.getItem("project-graph-web-client-id")).toBe(id);
    expect(ServerProjectManager.getClientId()).toBe(id);
  });
});
