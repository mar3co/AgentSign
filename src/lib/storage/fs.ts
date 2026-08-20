import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BlobStore } from "../storage.js";

/** Filesystem blob store for tests and local dogfood. Never use on Vercel function FS. */
export function createFsStore(rootDir: string): BlobStore {
  const pathFor = (key: string) => join(rootDir, key);

  return {
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },

    async get(key) {
      try {
        const buf = await readFile(pathFor(key));
        return new Uint8Array(buf);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async delete(key) {
      try {
        await unlink(pathFor(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
    },
  };
}
