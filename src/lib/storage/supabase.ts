import type { BlobStore } from "../storage.js";

/** Minimal Supabase Storage client surface (service role). */
export type SupabaseStorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Uint8Array,
        opts?: { contentType?: string; upsert?: boolean },
      ) => Promise<{ error: Error | null }>;
      download: (
        path: string,
      ) => Promise<{ data: Blob | null; error: Error | null }>;
      remove: (paths: string[]) => Promise<{ error: Error | null }>;
    };
  };
};

/** Private bucket blob store. Service role only; no public object URLs. */
export function createSupabaseStore(
  client: SupabaseStorageClient,
  bucket = "envelopes",
): BlobStore {
  const objects = () => client.storage.from(bucket);

  return {
    async put(key, bytes) {
      const { error } = await objects().upload(key, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (error) throw error;
    },

    async get(key) {
      const { data, error } = await objects().download(key);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async delete(key) {
      const { error } = await objects().remove([key]);
      if (error) throw error;
    },
  };
}
