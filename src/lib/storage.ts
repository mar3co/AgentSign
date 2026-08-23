export type BlobStore = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
};

export type ObjectKind = "original" | "sealed" | "certificate";

export function objectKey(documentId: string, kind: ObjectKind): string {
  return `${documentId}/${kind}.pdf`;
}

export function appearanceKey(documentId: string, signerId: string): string {
  return `${documentId}/appearance/${signerId}.png`;
}

export { createFsStore } from "./storage/fs.js";
export {
  createSupabaseStore,
  type SupabaseStorageClient,
} from "./storage/supabase.js";
