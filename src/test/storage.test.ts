import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore, objectKey } from "../lib/storage.js";

describe("fs blob store", () => {
  it("puts, gets, and hard-deletes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sign-blobs-"));
    const store = createFsStore(dir);
    const key = objectKey("env1", "original");
    await store.put(key, new Uint8Array([1, 2, 3]));
    expect(Array.from((await store.get(key))!)).toEqual([1, 2, 3]);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});
